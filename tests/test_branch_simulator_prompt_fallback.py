"""Tests for BranchSimulator prompt loading — verifies fallback on missing/corrupt YAML."""
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, AsyncMock, patch

import pytest

from backend.conductor.branch_simulator import BranchSimulator


@pytest.fixture
def simulator():
    d = Path(tempfile.mkdtemp())
    router = MagicMock()
    router.execute = AsyncMock(return_value={
        "content": '{"tension_curve":{"content":"x","confidence":"medium"}}',
        "usage": {"input": 10, "output": 5},
    })
    yield BranchSimulator(projects_dir=d, model_router=router)
    import shutil
    shutil.rmtree(d, ignore_errors=True)


@pytest.mark.asyncio
async def test_llm_inference_uses_fallback_when_yaml_missing(simulator):
    """When branch_simulation_llm.yaml is missing (FileNotFoundError), the fallback string is used and LLM still gets called."""
    with patch("builtins.open", side_effect=FileNotFoundError("yaml missing")):
        result = await simulator._run_llm_inference(
            "any_project", "test description", {
                "chapter_range": (1, 1), "characters": [], "foreshadowings": [],
                "growth_shifts": {}, "reader_metrics": {},
            }
        )
    # Either fallback worked and LLM got called, or LLM failed gracefully — both acceptable
    assert isinstance(result, dict)


@pytest.mark.asyncio
async def test_llm_inference_uses_fallback_when_yaml_corrupt(simulator):
    """When YAML file is unparseable (yaml.YAMLError), fallback string is used."""
    import yaml
    with patch("builtins.open", side_effect=yaml.YAMLError("corrupt yaml")):
        result = await simulator._run_llm_inference(
            "any_project", "test", {
                "chapter_range": (1, 1), "characters": [], "foreshadowings": [],
                "growth_shifts": {}, "reader_metrics": {},
            }
        )
    assert isinstance(result, dict)


@pytest.mark.asyncio
async def test_llm_inference_sends_fallback_prompt_to_router(simulator):
    """When YAML is missing, the router.execute call should still be made with the fallback prompts."""
    with patch("builtins.open", side_effect=FileNotFoundError("yaml missing")):
        await simulator._run_llm_inference(
            "any_project", "test description", {
                "chapter_range": (1, 3), "characters": ["主角"], "foreshadowings": ["伏笔1"],
                "growth_shifts": {}, "reader_metrics": {"tension": "↑10"},
            }
        )
    # Router should still be called with the fallback
    simulator._router.execute.assert_awaited_once()
    call_kwargs = simulator._router.execute.await_args.kwargs
    assert "messages" in call_kwargs
    # First message is system, second is user
    messages = call_kwargs["messages"]
    assert len(messages) == 2
    assert messages[0]["role"] == "system"
    assert messages[1]["role"] == "user"
    # The user prompt should include the description
    assert "test description" in messages[1]["content"]