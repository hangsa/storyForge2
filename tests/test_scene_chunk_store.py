"""SceneChunkStore persists per-chunk records for SSE reconnect补发.

Each scene has one .jsonl file. append() writes one line; read_since(since_seq)
yields records strictly newer than since_seq; total_text() concatenates all text;
clear() deletes the file (called once draft.md is written, or on failure).

Atomicity assumption: each chunk is <= 50 chars (~150 bytes UTF-8), well under
PIPE_BUF=4096 — POSIX O_APPEND keeps writes atomic for single-process appends.
"""

import json
import time
from pathlib import Path

import pytest

from backend.conductor.scene_chunk_store import (
    ChunkRecord, SceneChunkStore, chunk_path,
)


def _bootstrap(tmp_path: Path) -> Path:
    """Create a minimal project dir so SceneChunkStore has a parent path."""
    proj = tmp_path / "proj_test"
    proj.mkdir()
    chunks_dir = proj / "autopilot" / "chunks"
    chunks_dir.mkdir(parents=True)
    return proj


def test_append_assigns_monotonic_seq(tmp_path):
    proj = _bootstrap(tmp_path)
    store = SceneChunkStore(tmp_path, "proj_test", chapter_number=17, scene_number=2)
    r1 = store.append("夜风")
    r2 = store.append("如刀")
    r3 = store.append("。")
    assert [r.seq for r in (r1, r2, r3)] == [1, 2, 3]
    assert r1.text == "夜风"
    assert r2.text == "如刀"
    assert r3.text == "。"


def test_append_persists_one_json_per_line(tmp_path):
    proj = _bootstrap(tmp_path)
    store = SceneChunkStore(tmp_path, "proj_test", 17, 2)
    store.append("alpha")
    store.append("beta")
    path = chunk_path(tmp_path, "proj_test", 17, 2)
    raw = path.read_text(encoding="utf-8")
    lines = [line for line in raw.strip().split("\n") if line]
    assert len(lines) == 2
    parsed = [json.loads(line) for line in lines]
    assert parsed[0]["seq"] == 1
    assert parsed[0]["text"] == "alpha"
    assert parsed[1]["seq"] == 2
    assert parsed[1]["text"] == "beta"


def test_read_since_returns_only_chunks_after_seq(tmp_path):
    proj = _bootstrap(tmp_path)
    store = SceneChunkStore(tmp_path, "proj_test", 17, 2)
    for t in ["a", "b", "c", "d", "e"]:
        store.append(t)
    chunks = store.read_since(since_seq=2)
    assert [c.text for c in chunks] == ["c", "d", "e"]
    assert [c.seq for c in chunks] == [3, 4, 5]


def test_read_since_returns_empty_when_file_absent(tmp_path):
    proj = _bootstrap(tmp_path)
    store = SceneChunkStore(tmp_path, "proj_test", 99, 1)
    # Never appended; file should not exist (clear() not yet called).
    assert store.read_since(since_seq=0) == []


def test_total_text_concatenates_in_order(tmp_path):
    proj = _bootstrap(tmp_path)
    store = SceneChunkStore(tmp_path, "proj_test", 17, 2)
    store.append("夜")
    store.append("风")
    store.append("如刀")
    assert store.total_text() == "夜风如刀"


def test_clear_removes_file(tmp_path):
    proj = _bootstrap(tmp_path)
    store = SceneChunkStore(tmp_path, "proj_test", 17, 2)
    store.append("x")
    assert chunk_path(tmp_path, "proj_test", 17, 2).exists()
    store.clear()
    assert not chunk_path(tmp_path, "proj_test", 17, 2).exists()


def test_clear_is_idempotent(tmp_path):
    proj = _bootstrap(tmp_path)
    store = SceneChunkStore(tmp_path, "proj_test", 17, 2)
    store.clear()
    store.clear()  # second call must not raise
    assert not chunk_path(tmp_path, "proj_test", 17, 2).exists()


def test_seq_starts_at_one_on_fresh_instance(tmp_path):
    proj = _bootstrap(tmp_path)
    store1 = SceneChunkStore(tmp_path, "proj_test", 17, 2)
    store1.append("x")
    store2 = SceneChunkStore(tmp_path, "proj_test", 17, 2)
    # If the file already exists with seq=1, next append should be seq=2.
    r = store2.append("y")
    assert r.seq == 2


def test_chunk_record_fields(tmp_path):
    proj = _bootstrap(tmp_path)
    store = SceneChunkStore(tmp_path, "proj_test", 17, 2)
    before = time.time()
    r = store.append("text")
    after = time.time()
    assert r.chapter_number == 17
    assert r.scene_number == 2
    assert r.text == "text"
    assert before <= r.created_at <= after


def test_different_scenes_get_different_files(tmp_path):
    proj = _bootstrap(tmp_path)
    a = SceneChunkStore(tmp_path, "proj_test", 17, 1)
    b = SceneChunkStore(tmp_path, "proj_test", 17, 2)
    a.append("a-text")
    b.append("b-text")
    path_a = chunk_path(tmp_path, "proj_test", 17, 1)
    path_b = chunk_path(tmp_path, "proj_test", 17, 2)
    assert path_a != path_b
    assert path_a.exists() and path_b.exists()
    assert "a-text" in path_a.read_text()
    assert "b-text" in path_b.read_text()


def test_chunk_path_format(tmp_path):
    p = chunk_path(tmp_path, "proj_x", 3, 7)
    assert p == tmp_path / "proj_x" / "autopilot" / "chunks" / "ch03_scene_007.jsonl"
