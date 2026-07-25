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


def test_validate_happy_path_against_real_config(isolated_config):
    from backend.services.llm_config import validate
    validate(read_yaml())  # must not raise


def test_validate_rejects_unknown_default(isolated_config):
    from backend.services.llm_config import LLMConfigError, read_yaml, validate
    bad = read_yaml()
    bad["tiers"]["tier_1"]["default"] = "ghost-model"
    with pytest.raises(LLMConfigError) as exc:
        validate(bad)
    assert any(p.endswith("tier_1.default") for p in exc.value.invalid_paths)


def test_validate_rejects_empty_agent_mapping_entry(isolated_config):
    from backend.services.llm_config import LLMConfigError, read_yaml, validate
    bad = read_yaml()
    bad["agent_mapping"]["planner"][""] = {"tier": "tier_1"}
    with pytest.raises(LLMConfigError) as exc:
        validate(bad)
    assert any(p == "agent_mapping.planner.<empty>" for p in exc.value.invalid_paths)


def test_validate_rejects_missing_tier0(isolated_config):
    from backend.services.llm_config import LLMConfigError, read_yaml, validate
    bad = read_yaml()
    bad["tiers"].pop("tier_0")
    with pytest.raises(LLMConfigError) as exc:
        validate(bad)
    assert "tier_0" in exc.value.invalid_paths


def test_validate_rejects_agent_mapping_to_unknown_tier(isolated_config):
    from backend.services.llm_config import LLMConfigError, read_yaml, validate
    bad = read_yaml()
    bad["agent_mapping"]["planner"]["novelty_evaluation"]["tier"] = "tier_9"
    with pytest.raises(LLMConfigError) as exc:
        validate(bad)
    assert any("novelty_evaluation.tier" in p for p in exc.value.invalid_paths)


def test_validate_rejects_max_tokens_bool(isolated_config):
    from backend.services.llm_config import LLMConfigError, read_yaml, validate
    bad = read_yaml()
    # set the first model's max_tokens to True (passes naive isinstance(int))
    bad["tiers"]["tier_1"]["models"][0]["max_tokens"] = True
    with pytest.raises(LLMConfigError) as exc:
        validate(bad)
    assert any("max_tokens" in p for p in exc.value.invalid_paths)


def test_validate_reports_duplicate_model_ids_with_id(isolated_config):
    from backend.services.llm_config import LLMConfigError, read_yaml, validate
    bad = read_yaml()
    # add a duplicate of an existing model id in tier_1
    dup = dict(bad["tiers"]["tier_1"]["models"][0])
    dup["provider"] = "deepseek"
    bad["tiers"]["tier_1"]["models"].append(dup)
    with pytest.raises(LLMConfigError) as exc:
        validate(bad)
    paths = exc.value.invalid_paths
    assert any("duplicate_id=" in p for p in paths)
