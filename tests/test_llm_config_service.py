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


def test_write_yaml_atomic_creates_equivalent_file(isolated_config):
    import yaml as yaml_mod
    from backend.services.llm_config import read_yaml, write_yaml_atomic
    original = read_yaml()
    write_yaml_atomic(original)
    written = yaml_mod.safe_load(isolated_config.read_text(encoding="utf-8"))
    assert written == original


def test_write_yaml_atomic_cleans_tmp_on_failure(isolated_config, monkeypatch):
    from backend.services.llm_config import write_yaml_atomic
    monkeypatch.setattr("yaml.safe_dump", lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("boom")))
    data = read_yaml()
    with pytest.raises(RuntimeError):
        write_yaml_atomic(data)
    leftover = [p.name for p in isolated_config.parent.glob(".model_tiers.*.tmp")]
    assert leftover == []
