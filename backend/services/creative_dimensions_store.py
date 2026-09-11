"""全局创作维度 store（JSON 文件 + atomic write + seed bootstrap）。

API:
  load()                    -> DimensionsCatalog  (启动时调一次)
  list(kind, active_only)   -> list[DimensionEntry]
  add(kind, payload)        -> DimensionEntry    (生成 id)
  update(kind, id, payload) -> DimensionEntry
  delete(kind, id)          -> bool
  get(kind, id)             -> Optional[DimensionEntry]

启动 seed: load() 时若 JSON 文件不存在，调用 seed_loader() 拿到
DimensionsCatalog 并落盘；若 JSON 损坏，重命名 .bak 后重新走 seed。
"""
from __future__ import annotations

import json
import logging
import os
import re
import tempfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Callable, Optional

from backend.creative_os.creative_dimensions import (
    DimensionEntry,
    DimensionEntryPayload,
    DimensionsCatalog,
    VALID_KINDS,
)

logger = logging.getLogger(__name__)


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _slugify(name: str) -> str:
    """生成 slug（仅依赖 stdlib，不引入 pypinyin 等新依赖）。

    规则：
    - lowercase
    - 非 [a-z0-9] 替换为 _
    - 头尾 _ 去除
    - 结果为空（全中文 / 全符号）→ md5(name.encode()).hexdigest()[:8]

    副作用：用户添加中文 name 时拿不到拼音 slug，只拿到 8 字符 hash。
    由于 id 仅用作 API key（前端 UI 只展示 name），可接受。后续若要
    美化可在 pyproject.toml 加 pypinyin 并替换本函数。
    """
    import hashlib
    s = name.lower()
    s = re.sub(r"[^a-z0-9]+", "_", s)
    s = s.strip("_")
    if not s:
        s = hashlib.md5(name.encode("utf-8")).hexdigest()[:8]
    return s


class CreativeDimensionsStore:
    def __init__(
        self,
        store_path: Path,
        seed_loader: Callable[[], DimensionsCatalog],
    ):
        self._path = Path(store_path)
        self._seed_loader = seed_loader
        self._cache: Optional[DimensionsCatalog] = None

    def _save(self, catalog: DimensionsCatalog) -> None:
        """Atomic write: .tmp + os.replace."""
        self._path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp_name = tempfile.mkstemp(
            prefix=".creative_dimensions.", suffix=".tmp", dir=str(self._path.parent),
        )
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "subject": [vars(e) for e in catalog.subject],
                        "tone":    [vars(e) for e in catalog.tone],
                        "style":   [vars(e) for e in catalog.style],
                    },
                    f, ensure_ascii=False, indent=2,
                )
            os.replace(tmp_name, self._path)
        except Exception:
            if os.path.exists(tmp_name):
                os.unlink(tmp_name)
            raise

    def _validate_kind(self, kind: str) -> None:
        if kind not in VALID_KINDS:
            raise ValueError(f"unknown kind: {kind!r}")

    def _refresh_cache(self) -> DimensionsCatalog:
        if not self._path.exists():
            cat = self._seed_loader()
            self._save(cat)
            self._cache = cat
            return cat
        try:
            raw = json.loads(self._path.read_text("utf-8"))
            cat = DimensionsCatalog(
                subject=[DimensionEntry(**e) for e in raw.get("subject", [])],
                tone=[DimensionEntry(**e) for e in raw.get("tone", [])],
                style=[DimensionEntry(**e) for e in raw.get("style", [])],
            )
            self._cache = cat
            return cat
        except json.JSONDecodeError:
            logger.warning("creative_dimensions JSON decode failed, reseeding: %s", self._path)
            bak = self._path.with_suffix(self._path.suffix + ".bak")
            try:
                os.replace(self._path, bak)
            except FileNotFoundError:
                pass
            cat = self._seed_loader()
            self._save(cat)
            self._cache = cat
            return cat

    def load(self) -> DimensionsCatalog:
        """启动时调一次：读 JSON 或 seed bootstrap。"""
        return self._refresh_cache()

    def _get_catalog(self) -> DimensionsCatalog:
        if self._cache is None:
            return self._refresh_cache()
        return self._cache

    def list(self, kind: str, active_only: bool = False) -> list[DimensionEntry]:
        self._validate_kind(kind)
        cat = self._get_catalog()
        entries = getattr(cat, kind)
        if active_only:
            entries = [e for e in entries if e.status == "active"]
        return sorted(entries, key=lambda e: (e.order, e.id))

    def get(self, kind: str, entry_id: str) -> Optional[DimensionEntry]:
        self._validate_kind(kind)
        cat = self._get_catalog()
        for e in getattr(cat, kind):
            if e.id == entry_id:
                return e
        return None

    def _generate_unique_id(self, kind: str, name: str) -> str:
        base = _slugify(name)
        existing = {e.id for e in getattr(self._get_catalog(), kind)}
        candidate = base
        suffix = 2
        for _ in range(5):
            if candidate not in existing:
                return candidate
            candidate = f"{base}_{suffix}"
            suffix += 1
        raise RuntimeError(f"failed to generate unique id for {name!r} in {kind}")

    def _check_duplicate_name(self, kind: str, name: str, exclude_id: Optional[str] = None) -> None:
        for e in getattr(self._get_catalog(), kind):
            if e.name == name and e.id != exclude_id:
                raise ValueError(f"duplicate name: {name!r} in {kind}")

    def add(self, kind: str, payload: DimensionEntryPayload) -> DimensionEntry:
        self._validate_kind(kind)
        self._check_duplicate_name(kind, payload.name)
        now = _now_iso()
        entry = DimensionEntry(
            id=self._generate_unique_id(kind, payload.name),
            name=payload.name,
            description=payload.description,
            status=payload.status,
            family=payload.family,
            label_en=payload.label_en,
            order=payload.order,
            created_at=now,
            updated_at=now,
        )
        cat = self._get_catalog()
        getattr(cat, kind).append(entry)
        self._save(cat)
        return entry

    def update(self, kind: str, entry_id: str, payload: DimensionEntryPayload) -> DimensionEntry:
        self._validate_kind(kind)
        cat = self._get_catalog()
        for i, e in enumerate(getattr(cat, kind)):
            if e.id == entry_id:
                self._check_duplicate_name(kind, payload.name, exclude_id=entry_id)
                new_entry = DimensionEntry(
                    id=entry_id,
                    name=payload.name,
                    description=payload.description,
                    status=payload.status,
                    # 管理页表单已不再提供这两个字段；省略时保留原值而非清空
                    family=payload.family if payload.family is not None else e.family,
                    label_en=payload.label_en if payload.label_en is not None else e.label_en,
                    order=payload.order,
                    created_at=e.created_at,
                    updated_at=_now_iso(),
                )
                getattr(cat, kind)[i] = new_entry
                self._save(cat)
                return new_entry
        raise ValueError(f"entry not found: {entry_id!r} in {kind}")

    def delete(self, kind: str, entry_id: str) -> bool:
        self._validate_kind(kind)
        cat = self._get_catalog()
        entries = getattr(cat, kind)
        for i, e in enumerate(entries):
            if e.id == entry_id:
                entries.pop(i)
                self._save(cat)
                return True
        return False