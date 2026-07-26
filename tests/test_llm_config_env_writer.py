from pathlib import Path

import pytest

from backend.services.llm_config import write_env_atomic


@pytest.fixture
def env_path(tmp_path):
    p = tmp_path / ".env"
    p.write_text("A=1\nB=two\n# comment\nC=3\n", encoding="utf-8")
    return p


def test_write_env_atomic_updates_existing_key(env_path):
    write_env_atomic(env_path, {"B": "two-new"})
    text = env_path.read_text(encoding="utf-8")
    lines = text.splitlines()
    assert lines[0] == "A=1"
    assert lines[1] == "B=two-new"
    assert lines[2] == "# comment"
    assert lines[3] == "C=3"


def test_write_env_atomic_appends_new_key(env_path):
    write_env_atomic(env_path, {"D": "four"})
    text = env_path.read_text(encoding="utf-8")
    assert text.endswith("D=four\n")


def test_write_env_atomic_cleans_tmp_on_failure(env_path, monkeypatch):
    from backend.services import llm_config as mod
    monkeypatch.setattr(mod, "_env_replace", lambda _src, _dst: (_ for _ in ()).throw(RuntimeError("boom")))
    with pytest.raises(RuntimeError):
        write_env_atomic(env_path, {"B": "x"})
    leftover = [p.name for p in env_path.parent.glob(".env.*.tmp")]
    assert leftover == []


def test_write_env_atomic_quotes_value_with_spaces(env_path):
    write_env_atomic(env_path, {"E": "has space"})
    text = env_path.read_text(encoding="utf-8")
    assert 'E="has space"' in text