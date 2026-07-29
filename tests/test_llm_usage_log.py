import json
from pathlib import Path

import pytest

from backend.services import llm_usage_log as mod
from backend.services.llm_usage_log import read_recent


@pytest.fixture
def fake_usage(tmp_path, monkeypatch):
    log = tmp_path / "llm_usage.jsonl"
    monkeypatch.setattr(mod, "USAGE_PATH", log)
    return log


def test_read_recent_empty_when_file_missing(fake_usage):
    assert read_recent(50) == []


def test_read_recent_returns_newest_first(fake_usage):
    rows = [
        {"timestamp": f"2026-07-26T{i:02d}:00:00Z", "agent": "writer",
         "task": "scene_writing", "tier": "tier_1",
         "model": "deepseek-v4-pro", "tokens_in": 100*i, "tokens_out": 50*i, "cost": 0.001}
        for i in range(1, 6)
    ]
    fake_usage.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n",
        encoding="utf-8",
    )
    out = read_recent(3)
    assert [r["timestamp"] for r in out] == [
        "2026-07-26T05:00:00Z",
        "2026-07-26T04:00:00Z",
        "2026-07-26T03:00:00Z",
    ]


def test_read_recent_skips_malformed_lines(fake_usage):
    fake_usage.write_text(
        "not json\n"
        '{"timestamp":"t","agent":"a","task":"x","tier":"tier_1","model":"m","tokens_in":1,"tokens_out":1,"cost":0.0}\n',
        encoding="utf-8",
    )
    out = read_recent(10)
    assert len(out) == 1
    assert out[0]["agent"] == "a"


def test_read_recent_handles_large_file_bounded_memory(fake_usage):
    rows = [
        {"timestamp": f"2026-07-26T{i // 60:02d}:{i % 60:02d}:00Z",
         "agent": "writer", "task": "scene_writing", "tier": "tier_1",
         "model": "m", "tokens_in": 1, "tokens_out": 1, "cost": 0.0}
        for i in range(500)
    ]
    fake_usage.write_text(
        "\n".join(json.dumps(r, ensure_ascii=False) for r in rows) + "\n",
        encoding="utf-8",
    )
    out = read_recent(10)
    assert len(out) == 10
    assert [r["timestamp"] for r in out] == [rows[i]["timestamp"] for i in range(499, 489, -1)]


def test_read_recent_logs_warning_on_oserror(tmp_path, monkeypatch, caplog):
    import logging
    from pathlib import Path
    bad = tmp_path / "no-such-dir" / "nope.jsonl"
    monkeypatch.setattr(mod, "USAGE_PATH", bad)
    # bypass the is_file() early-return so open() raises OSError
    monkeypatch.setattr(Path, "is_file", lambda self: True)
    with caplog.at_level(logging.WARNING, logger="backend.services.llm_usage_log"):
        assert read_recent(10) == []
    assert any("Failed to read usage log" in rec.message for rec in caplog.records)
