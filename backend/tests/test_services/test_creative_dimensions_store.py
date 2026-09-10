"""Unit tests for CreativeDimensionsStore."""
from __future__ import annotations

import json
from pathlib import Path

import pytest

from backend.creative_os.creative_dimensions import (
    DimensionsCatalog,
    DimensionEntry,
    DimensionEntryPayload,
)
from backend.services.creative_dimensions_store import CreativeDimensionsStore


@pytest.fixture
def tmp_store_path(tmp_path: Path) -> Path:
    return tmp_path / "creative_dimensions.json"


def _stub_seed() -> DimensionsCatalog:
    return DimensionsCatalog(
        subject=[DimensionEntry(id="xuanhuan", name="玄幻", description="",
                                status="active", order=0,
                                created_at="2026-01-01T00:00:00Z",
                                updated_at="2026-01-01T00:00:00Z")],
        tone=[DimensionEntry(id="rexue", name="热血", description="",
                             status="active", order=0,
                             created_at="2026-01-01T00:00:00Z",
                             updated_at="2026-01-01T00:00:00Z")],
        style=[],
    )


def test_load_creates_seed_when_missing(tmp_store_path: Path):
    """JSON 不存在 → 自动调用 seed loader 并落盘。"""
    calls = []

    def loader():
        calls.append(True)
        return _stub_seed()

    store = CreativeDimensionsStore(tmp_store_path, loader)
    cat = store.load()
    assert len(calls) == 1
    assert len(cat.subject) == 1
    assert tmp_store_path.exists()


def test_load_uses_existing_file(tmp_store_path: Path):
    """JSON 已存在 → 不调 seed loader。"""
    tmp_store_path.write_text(json.dumps({
        "subject": [{"id": "pre", "name": "预设", "description": "",
                     "status": "active", "order": 0,
                     "created_at": "x", "updated_at": "x"}],
        "tone": [], "style": [],
    }, ensure_ascii=False))

    calls = []
    store = CreativeDimensionsStore(tmp_store_path, lambda: calls.append(True) or _stub_seed())
    cat = store.load()
    assert calls == []
    assert cat.subject[0].id == "pre"


def test_load_recovers_from_corrupt_json(tmp_store_path: Path, caplog):
    """JSON 损坏 → 重命名 .bak，重新走 seed 初始化。"""
    tmp_store_path.write_text("{not valid json")

    def loader():
        return _stub_seed()

    store = CreativeDimensionsStore(tmp_store_path, loader)
    cat = store.load()
    assert len(cat.subject) == 1
    bak = tmp_store_path.with_suffix(".json.bak")
    assert bak.exists()
    assert any("JSON decode failed" in r.message for r in caplog.records)


def test_add_generates_id_and_persists(tmp_store_path: Path):
    store = CreativeDimensionsStore(tmp_store_path, _stub_seed)
    store.load()
    entry = store.add("tone", DimensionEntryPayload(name="新基调"))
    # 中文 name → slug 走 hex hash fallback（非空 + 长度合理 + 唯一）
    assert entry.id and len(entry.id) >= 8
    assert entry.status == "active"
    # 落盘
    raw = json.loads(tmp_store_path.read_text("utf-8"))
    assert any(e["id"] == entry.id for e in raw["tone"])


def test_add_duplicate_name_raises(tmp_store_path: Path):
    store = CreativeDimensionsStore(tmp_store_path, _stub_seed)
    store.load()
    with pytest.raises(ValueError, match="duplicate name"):
        store.add("tone", DimensionEntryPayload(name="热血"))


def test_update_modifies_entry(tmp_store_path: Path):
    store = CreativeDimensionsStore(tmp_store_path, _stub_seed)
    store.load()
    updated = store.update("tone", "rexue", DimensionEntryPayload(
        name="热血（升级）", description="激烈昂扬", status="active", order=5,
    ))
    assert updated.name == "热血（升级）"
    assert updated.description == "激烈昂扬"
    assert updated.order == 5
    # get 返回更新后
    fetched = store.get("tone", "rexue")
    assert fetched is not None
    assert fetched.description == "激烈昂扬"


def test_update_not_found_raises(tmp_store_path: Path):
    store = CreativeDimensionsStore(tmp_store_path, _stub_seed)
    store.load()
    with pytest.raises(ValueError, match="not found"):
        store.update("tone", "missing", DimensionEntryPayload(name="x"))


def test_delete_removes_entry(tmp_store_path: Path):
    store = CreativeDimensionsStore(tmp_store_path, _stub_seed)
    store.load()
    assert store.delete("tone", "rexue") is True
    assert store.get("tone", "rexue") is None


def test_delete_not_found_returns_false(tmp_store_path: Path):
    store = CreativeDimensionsStore(tmp_store_path, _stub_seed)
    store.load()
    assert store.delete("tone", "missing") is False


def test_list_filters_by_active(tmp_store_path: Path):
    """list(kind, active_only=True) 仅返回 status=='active'。"""
    store = CreativeDimensionsStore(tmp_store_path, _stub_seed)
    store.load()
    inactive_entry = store.add("tone", DimensionEntryPayload(name="废弃基调", status="inactive"))
    active = store.list("tone", active_only=True)
    inactive = store.list("tone", active_only=False)
    # 中文 name → hash-based id, 不是 pinyin slug "feiqi_ji_diao"
    assert {e.id for e in active} == {"rexue"}
    assert {e.id for e in inactive} == {"rexue", inactive_entry.id}


def test_atomic_write_no_partial_files(tmp_store_path: Path):
    """atomic write: .tmp + replace，不留半成品。"""
    store = CreativeDimensionsStore(tmp_store_path, _stub_seed)
    store.load()
    store.add("tone", DimensionEntryPayload(name="原子测试"))
    leftovers = [p for p in tmp_store_path.parent.glob(".creative_dimensions.json.*.tmp")]
    assert leftovers == []