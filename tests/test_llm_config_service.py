from pathlib import Path

import pytest

from backend.services.llm_config import read_yaml

REAL_CONFIG = Path("config/model_tiers.yaml")


@pytest.fixture
def isolated_config(tmp_path, monkeypatch):
    """Point CONFIG_PATH at a tmp copy of the real file."""
    import shutil
    target = tmp_path / "model_tiers.yaml"
    shutil.copy(REAL_CONFIG, target)
    import backend.services.llm_config as mod
    monkeypatch.setattr(mod, "CONFIG_PATH", target)
    return target


def test_read_yaml_returns_parseable_dict(isolated_config):
    data = read_yaml()
    assert isinstance(data, dict)
    assert "tiers" in data
    assert "agent_mapping" in data
    assert "tier_1" in data["tiers"]
