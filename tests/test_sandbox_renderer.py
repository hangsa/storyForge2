from unittest.mock import AsyncMock, MagicMock

import pytest

from backend.style_engine.sandbox_models import SandboxParams
from backend.style_engine.sandbox_renderer import compute_avg_length, render_preview


def test_compute_avg_length_chinese():
    # Three Chinese sentences of 10/20/30 characters (excluding punctuation)
    text = "你好世界。今天天气非常的好像要下雨但是又晴朗了。"
    avg = compute_avg_length(text)
    # Should be > 0 and < 50
    assert 0 < avg < 50


def test_compute_avg_length_empty():
    assert compute_avg_length("") == 0.0


def test_compute_avg_length_single_sentence():
    assert compute_avg_length("只有一句。") > 0


@pytest.mark.asyncio
async def test_render_preview_success_returns_response():
    fake_router = MagicMock()
    fake_router.execute = AsyncMock(return_value={
        "content": "渲染后的文本内容，节奏更快。",
        "usage": {"input": 800, "output": 600},
        "model": "claude-haiku", "tier": "tier_3", "cost": 0.001,
    })
    params = SandboxParams()
    params.sentence.avg_length_range = [10, 20]
    resp = await render_preview(
        model_router=fake_router,
        source_text="原文文本" * 30,
        params=params,
        genre="cool_novel",
    )
    assert resp.rendered_text == "渲染后的文本内容，节奏更快。"
    assert resp.tokens_used == 1400
    assert resp.source_avg_length > 0
    assert resp.rendered_avg_length > 0


@pytest.mark.asyncio
async def test_render_preview_skipped_when_router_unavailable():
    fake_router = MagicMock()
    fake_router.execute = AsyncMock(return_value={
        "content": "", "usage": {"input": 0, "output": 0},
        "model": "none", "tier": "tier_3", "cost": 0.0,
    })
    resp = await render_preview(
        model_router=fake_router,
        source_text="x" * 200,
        params=SandboxParams(),
        genre="cool_novel",
    )
    assert resp.rendered_text == ""
    assert resp.skipped_reason == "no LLM response"


@pytest.mark.asyncio
async def test_render_preview_skipped_when_router_raises():
    fake_router = MagicMock()
    fake_router.execute = AsyncMock(side_effect=Exception("offline"))
    resp = await render_preview(
        model_router=fake_router,
        source_text="x" * 200,
        params=SandboxParams(),
        genre="cool_novel",
    )
    assert resp.skipped_reason
    assert resp.rendered_text == ""


from backend.style_engine.sandbox_renderer import save_sandbox_config, list_sandbox_configs, load_sandbox_config, _sanitize_name


def test_sanitize_name_strips_path_separators():
    assert _sanitize_name("../etc/passwd") == "etc_passwd"
    assert _sanitize_name("foo\\bar") == "foo_bar"
    assert _sanitize_name("normal name") == "normal_name"
    assert _sanitize_name("") == "unnamed"


def test_save_and_list_roundtrip(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    (tmp_path / "p1" / "styles").mkdir(parents=True)
    params = SandboxParams()
    params.sentence.avg_length_range = [8, 20]
    path = save_sandbox_config(project_id="p1", name="快节奏", params=params)
    assert path.exists()
    assert path.name == "快节奏.yaml" or path.name.endswith(".yaml")
    configs = list_sandbox_configs(project_id="p1")
    assert len(configs) == 1
    assert configs[0].name == "快节奏"


def test_save_rejects_duplicate_name(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    (tmp_path / "p1" / "styles").mkdir(parents=True)
    params = SandboxParams()
    save_sandbox_config(project_id="p1", name="dup", params=params)
    import pytest
    with pytest.raises(FileExistsError):
        save_sandbox_config(project_id="p1", name="dup", params=params)


def test_load_saved_config(tmp_path, monkeypatch):
    from backend.config import settings
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    (tmp_path / "p1" / "styles").mkdir(parents=True)
    params = SandboxParams()
    params.dialogue.ratio = 0.5
    save_sandbox_config(project_id="p1", name="dialogue_heavy", params=params)
    loaded = load_sandbox_config(project_id="p1", name="dialogue_heavy")
    assert loaded.params.dialogue.ratio == 0.5
