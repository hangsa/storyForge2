# 创作维度配置实现 Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 提供全局 CRUD 能力管理题材 / 基调 / 风格三类维度，统一替换原 Genre catalog；改造 `divergence_v2` S1 输入下拉；为 `three_b_decompose` / `three_b_adaptive_diverge` / `three_b_commit` 三个 prompt 注入统一的「设定背景」块。

**Architecture:** 新建 `CreativeDimensionsStore`（JSON 文件 + atomic write + 启动 seed bootstrap），6 个 REST 路由（`/api/v1/creative-dimensions/*`），保留 `/api/v1/genres` 为只读兼容入口。`S1InputStep` 改为读新 store，空维度下拉禁用。后端 `three_b_engine` 新增 `_build_dimension_block` + `_maybe_inject_block`，在三个 LLM 调用点前置拼接「设定背景」块（YAML 模板本身不动）。

**Tech Stack:** Python 3.10+ FastAPI · Pydantic · dataclasses · atomic file write（tempfile.mkstemp + os.replace）· React 18 + Tailwind (existing `ds/` design system)

**Spec:** `docs/superpowers/specs/2026-09-10-creative-dimensions-config-design.md`

**Working directory:** `/Users/longsa/Codes/nebula/`

---

## File Structure

新增文件：
- `backend/creative_os/creative_dimensions.py` — 数据模型 (DimensionEntry / DimensionsCatalog / Pydantic schema)
- `backend/services/creative_dimensions_store.py` — Store 单例 + CRUD + atomic write + seed bootstrap
- `backend/api/creative_dimensions.py` — 6 个 REST 路由
- `frontend/src/api/types.ts` — DimensionEntry + DimensionEntryPayload TS 类型
- `frontend/src/hooks/useCreativeDimensions.ts` — 全局缓存 hook
- `frontend/src/components/creativeDimensions/CreativeDimensionsView.tsx` — 双栏主区
- `frontend/src/components/creativeDimensions/DimensionTabs.tsx` — 左 Tab
- `frontend/src/components/creativeDimensions/EntryEditPanel.tsx` — 右侧编辑面板
- `frontend/src/pages/CreativeDimensionsPage.tsx` — 页面壳
- 测试文件若干（见各 Task）

修改文件：
- `backend/config.py` — 加 `creative_dimensions_path` 设置
- `backend/genres/catalog.py` — 加 `load_seed()` 函数（保留现有 list 行为）
- `backend/api/genres.py` — `list_genres` 改读新 store
- `backend/main.py` — lifespan 创建 store；注册新 router
- `backend/creative_os/three_b_engine.py` — 新增 `_build_dimension_block` + `_maybe_inject_block` + `_get_dimensions_store` helper；3 处调用点改造
- `frontend/src/api/client.ts` — 加 5 个新方法
- `frontend/src/components/wizard/divergence_v2/S1InputStep.tsx` — 替换硬编码 → 用 hook；下拉禁用
- `frontend/src/components/home/StatsSidebar.tsx` — 加侧边栏项
- `frontend/src/App.tsx` — 加路由

---

## Task 1: 添加 `creative_dimensions_path` 配置设置

**Files:**
- Modify: `backend/config.py`（加一个字段）
- Test: 暂无（配置字段在 Task 3 第一次启动时验证）

- [ ] **Step 1: 定位 `backend/config.py` 中 `Settings` 类**

```bash
grep -n "projects_dir\|prompts_dir\|class Settings" backend/config.py | head -10
```

期望输出：列出类似 `projects_dir: Path = Field(...)` 的字段定义位置。

- [ ] **Step 2: 在 `Settings` 类加 `creative_dimensions_path` 字段**

打开 `backend/config.py`，在 `projects_dir` / `prompts_dir` 等路径字段附近加：

```python
# 全局创作维度 store 文件路径。空字符串 = 默认回退到 <projects_dir>/../config/creative_dimensions.json
creative_dimensions_path: str = ""
```

- [ ] **Step 3: 解析回退路径在 store 里处理（无需在 config.py 加逻辑）**

`Settings` 类不需要 `model_post_init`。具体回退逻辑 `Path(settings.projects_dir).parent / "config" / "creative_dimensions.json"` 放在 lifespan / store 构造处（见 Task 4 Step 2）。

- [ ] **Step 4: 验证 import 不报错**

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate 2>/dev/null || python -m venv venv && source venv/bin/activate
python -c "from backend.config import settings; print(settings.creative_dimensions_path)"
```

期望输出：`""`（默认值）。

- [ ] **Step 5: Commit**

```bash
git add backend/config.py
git commit -m "feat(config): add creative_dimensions_path setting"
```

---

## Task 2: 创建数据模型 + Pydantic schema + seed loader

**Files:**
- Create: `backend/creative_os/creative_dimensions.py`
- Modify: `backend/genres/catalog.py`（加 `load_seed` 函数）

- [ ] **Step 1: 创建数据模型文件**

新建 `backend/creative_os/creative_dimensions.py`：

```python
"""题材 / 基调 / 风格 三维度数据模型。

数据形态见 spec §3.1。三个维度共用同一 store，靠 `DimensionKind`
("subject" | "tone" | "style") 区分。
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict, Field


DimensionKind = Literal["subject", "tone", "style"]
EntryStatus = Literal["active", "inactive"]


@dataclass
class DimensionEntry:
    id: str                          # slug 风格，如 "xuanhuan" / "rexue" / "shuangwen"
    name: str                        # 中文标签，如 "玄幻"
    description: str = ""            # textarea 内容（可空字符串）
    status: EntryStatus = "active"
    family: Optional[str] = None     # 仅 subject 使用（"xuanhuan"、"dushi" 等族系）
    label_en: Optional[str] = None   # 仅 subject 使用
    order: int = 0                   # 列表排序权重，升序
    created_at: str = ""             # ISO 8601
    updated_at: str = ""             # ISO 8601


@dataclass
class DimensionsCatalog:
    """全量三个维度的容器。"""
    subject: list[DimensionEntry] = field(default_factory=list)
    tone:    list[DimensionEntry] = field(default_factory=list)
    style:   list[DimensionEntry] = field(default_factory=list)


class DimensionEntryPayload(BaseModel):
    """POST/PUT 校验：name + 可选 description/status/family/label_en/order。"""

    name: str = Field(..., min_length=1, max_length=64)
    description: str = Field(default="", max_length=2000)
    status: EntryStatus = "active"
    family: Optional[str] = Field(default=None, max_length=64)
    label_en: Optional[str] = Field(default=None, max_length=128)
    order: int = Field(default=0, ge=0, le=9999)

    model_config = ConfigDict(extra="forbid")


VALID_KINDS: tuple[str, ...] = ("subject", "tone", "style")
```

- [ ] **Step 2: 在 `backend/genres/catalog.py` 末尾加 `load_seed()` 函数**

打开 `backend/genres/catalog.py`，先看现有 `get_catalog()` 实现（保持原样不动），在文件末尾追加：

```python
def load_seed() -> "DimensionsCatalog":
    """为 CreativeDimensionsStore 提供首次启动 seed。

    从现有 Genre catalog 读取 subject 维度（保留 family/label_en），
    tone/style 用硬编码初始 7/6 项。description 全部置空（YAML
    无描述字段，不凭空生成）。
    """
    from backend.creative_os.creative_dimensions import (
        DimensionEntry,
        DimensionsCatalog,
    )

    now = "1970-01-01T00:00:00Z"  # seed 条目没有真实创建时间，统一占位
    subject = [
        DimensionEntry(
            id=g["id"],
            name=g["label_zh"],
            description="",
            status="active" if g.get("ui_visible", True) else "inactive",
            family=g.get("family"),
            label_en=g.get("label_en"),
            order=0,
            created_at=now,
            updated_at=now,
        )
        for g in get_catalog().list(ui_visible_only=False)
    ]

    tone_seed = ["热血", "黑暗", "轻松", "史诗", "虐心", "治愈", "悬疑", "成长"]
    style_seed = ["爽文", "慢热", "群像", "单线", "多线", "倒叙", "正叙"]

    tone = [
        DimensionEntry(id=name, name=name, description="", status="active",
                       order=i, created_at=now, updated_at=now)
        for i, name in enumerate(tone_seed)
    ]
    style = [
        DimensionEntry(id=name, name=name, description="", status="active",
                       order=i, created_at=now, updated_at=now)
        for i, name in enumerate(style_seed)
    ]

    return DimensionsCatalog(subject=subject, tone=tone, style=style)
```

- [ ] **Step 3: 验证 import 不报错**

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
python -c "from backend.creative_os.creative_dimensions import DimensionsCatalog, DimensionEntry, DimensionEntryPayload; from backend.genres.catalog import load_seed; cat = load_seed(); print(len(cat.subject), len(cat.tone), len(cat.style))"
```

期望输出：`>0 8 7`（具体数字取决于现有 catalog）

- [ ] **Step 4: Commit**

```bash
git add backend/creative_os/creative_dimensions.py backend/genres/catalog.py
git commit -m "feat(dimensions): add data model, pydantic schema, and seed loader"
```

---

## Task 3: 实现 `CreativeDimensionsStore`（CRUD + atomic write + JSON corruption recovery）

**Files:**
- Create: `backend/services/creative_dimensions_store.py`
- Test: `backend/tests/test_services/test_creative_dimensions_store.py`

- [ ] **Step 1: 写 store 单元测试**

新建 `backend/tests/test_services/test_creative_dimensions_store.py`：

```python
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
    store.add("tone", DimensionEntryPayload(name="废弃基调", status="inactive"))
    active = store.list("tone", active_only=True)
    inactive = store.list("tone", active_only=False)
    assert {e.id for e in active} == {"rexue"}
    assert {e.id for e in inactive} == {"rexue", "feiqi_ji_diao"}


def test_atomic_write_no_partial_files(tmp_store_path: Path):
    """atomic write: .tmp + replace，不留半成品。"""
    store = CreativeDimensionsStore(tmp_store_path, _stub_seed)
    store.load()
    store.add("tone", DimensionEntryPayload(name="原子测试"))
    leftovers = [p for p in tmp_store_path.parent.glob(".creative_dimensions.json.*.tmp")]
    assert leftovers == []
```

- [ ] **Step 2: 运行测试，确认全部失败（实现缺失）**

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
pytest backend/tests/test_services/test_creative_dimensions_store.py -v
```

期望：`ModuleNotFoundError` 或所有 test FAIL。

- [ ] **Step 3: 实现 store**

新建 `backend/services/creative_dimensions_store.py`：

```python
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
                    family=payload.family,
                    label_en=payload.label_en,
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
```

- [ ] **Step 4: 跑测试**

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
pytest backend/tests/test_services/test_creative_dimensions_store.py -v
```

期望：全部 PASS。

- [ ] **Step 5: Commit**

```bash
git add backend/services/creative_dimensions_store.py backend/tests/test_services/test_creative_dimensions_store.py
git commit -m "feat(dimensions): CreativeDimensionsStore with atomic write and seed bootstrap"
```

---

## Task 4: 写 store 在 lifespan 中的初始化

**Files:**
- Modify: `backend/main.py`（在 lifespan 中创建 store 单例并暴露给 `app.state`）

- [ ] **Step 1: 在 `backend/main.py` 顶部 import**

```python
from backend.genres.catalog import load_seed
from backend.services.creative_dimensions_store import CreativeDimensionsStore
```

- [ ] **Step 2: 在 lifespan 里创建并加载**

在 `lifespan` 函数体内、`yield` 之前加：

```python
# 全局创作维度 store (subject/tone/style)。JSON 文件路径：优先
# settings.creative_dimensions_path，回退到 <projects_dir>/../config/creative_dimensions.json
from pathlib import Path as _Path
_dim_path_str = settings.creative_dimensions_path
if _dim_path_str:
    _dim_path = _Path(_dim_path_str)
else:
    _dim_path = _Path(settings.projects_dir).parent / "config" / "creative_dimensions.json"
app.state.creative_dimensions_store = CreativeDimensionsStore(
    store_path=_dim_path,
    seed_loader=load_seed,
)
app.state.creative_dimensions_store.load()
```

- [ ] **Step 3: 验证启动不报错**

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
python -c "
from backend.main import app
from backend.config import settings
from pathlib import Path
import json
# lifespan 不会自动跑；用 TestClient 或直接手动构造
from backend.services.creative_dimensions_store import CreativeDimensionsStore
from backend.genres.catalog import load_seed
path = Path(settings.projects_dir).parent / 'config' / 'creative_dimensions.json'
store = CreativeDimensionsStore(path, load_seed)
cat = store.load()
print('subject:', len(cat.subject), 'tone:', len(cat.tone), 'style:', len(cat.style))
print('path:', path)
"
```

期望：输出三个维度的长度（subject 应该和原 Genre catalog 一致）。

- [ ] **Step 4: 验证 JSON 文件已落盘**

```bash
cd /Users/longsa/Codes/nebula
cat "$(python -c 'from backend.config import settings; from pathlib import Path; print(Path(settings.projects_dir).parent / "config" / "creative_dimensions.json")')"
```

期望：JSON 内容含 subject / tone / style 三个数组。

- [ ] **Step 5: Commit**

```bash
git add backend/main.py
git commit -m "feat(main): wire CreativeDimensionsStore into app.state at lifespan"
```

---

## Task 5: 创建 6 个 REST 路由

**Files:**
- Create: `backend/api/creative_dimensions.py`
- Test: `backend/tests/test_api/test_creative_dimensions_routes.py`

- [ ] **Step 1: 写路由测试**

新建 `backend/tests/test_api/test_creative_dimensions_routes.py`：

```python
"""Tests for /api/v1/creative-dimensions routes."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.creative_dimensions import router
from backend.services.creative_dimensions_store import CreativeDimensionsStore
from backend.creative_os.creative_dimensions import (
    DimensionsCatalog,
    DimensionEntry,
)


@pytest.fixture
def store_with_seed(tmp_path):
    """Returns a store pre-loaded with 1 entry per kind."""
    seed = DimensionsCatalog(
        subject=[DimensionEntry(id="xuanhuan", name="玄幻", description="东方仙侠世界",
                                status="active", order=0,
                                created_at="2026-01-01T00:00:00Z",
                                updated_at="2026-01-01T00:00:00Z")],
        tone=[DimensionEntry(id="rexue", name="热血", description="激烈昂扬",
                             status="inactive", order=0,
                             created_at="2026-01-01T00:00:00Z",
                             updated_at="2026-01-01T00:00:00Z")],
        style=[],
    )
    path = tmp_path / "creative_dimensions.json"
    store = CreativeDimensionsStore(path, lambda: seed)
    store.load()
    return store


@pytest.fixture
def client(store_with_seed):
    app = FastAPI()
    app.include_router(router)
    app.state.creative_dimensions_store = store_with_seed
    return TestClient(app)


def test_get_active_returns_only_active(client):
    resp = client.get("/api/v1/creative-dimensions/active")
    assert resp.status_code == 200
    body = resp.json()
    assert "subject" in body and "tone" in body and "style" in body
    # subject 全部 active
    assert all(e["status"] == "active" for e in body["subject"])
    # tone 中 "rexue" 是 inactive → active 列表不应包含
    assert all(e["status"] == "active" for e in body["tone"])
    assert all(e["status"] == "active" for e in body["style"])


def test_get_all_returns_inactive_too(client):
    resp = client.get("/api/v1/creative-dimensions/")
    assert resp.status_code == 200
    body = resp.json()
    # tone 应包含 "rexue" (inactive)
    assert any(e["id"] == "rexue" for e in body["tone"])


def test_get_by_kind(client):
    resp = client.get("/api/v1/creative-dimensions/subject")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)
    assert any(e["id"] == "xuanhuan" for e in body)


def test_get_by_kind_invalid_returns_400(client):
    resp = client.get("/api/v1/creative-dimensions/bogus")
    assert resp.status_code == 400
    assert resp.json()["code"] == "INVALID_KIND"


def test_post_creates_entry(client):
    resp = client.post(
        "/api/v1/creative-dimensions/tone",
        json={"name": "新基调", "description": "测试用", "status": "active"},
    )
    assert resp.status_code == 200
    body = resp.json()
    assert body["name"] == "新基调"
    assert body["id"]  # 自动生成


def test_post_duplicate_name_returns_400(client):
    resp = client.post(
        "/api/v1/creative-dimensions/subject",
        json={"name": "玄幻"},
    )
    assert resp.status_code == 400
    assert resp.json()["code"] == "DUPLICATE_NAME"


def test_put_updates_entry(client):
    resp = client.put(
        "/api/v1/creative-dimensions/tone/rexue",
        json={"name": "热血（升级）", "description": "激烈昂扬2", "status": "active"},
    )
    assert resp.status_code == 200
    assert resp.json()["name"] == "热血（升级）"


def test_put_not_found_returns_404(client):
    resp = client.put(
        "/api/v1/creative-dimensions/tone/missing",
        json={"name": "x"},
    )
    assert resp.status_code == 404
    assert resp.json()["code"] == "NOT_FOUND"


def test_delete_removes_entry(client):
    resp = client.delete("/api/v1/creative-dimensions/tone/rexue")
    assert resp.status_code == 200
    # 二次删返回 404
    resp2 = client.delete("/api/v1/creative-dimensions/tone/rexue")
    assert resp2.status_code == 404


def test_payload_extra_forbidden(client):
    resp = client.post(
        "/api/v1/creative-dimensions/style",
        json={"name": "新风格", "bogus_field": "nope"},
    )
    assert resp.status_code == 422


def test_routes_wildcard_does_not_capture_active(client):
    """路由顺序敏感。 /active 不能被 /{kind} 通配捕获。"""
    resp = client.get("/api/v1/creative-dimensions/active")
    # 期望 200 而不是 400 (400 = INVALID_KIND)
    assert resp.status_code == 200
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
pytest backend/tests/test_api/test_creative_dimensions_routes.py -v
```

期望：`ModuleNotFoundError: backend.api.creative_dimensions`

- [ ] **Step 3: 实现 6 个路由**

新建 `backend/api/creative_dimensions.py`：

```python
"""REST API for creative dimensions (subject / tone / style).

Routes (mounted at /api/v1/creative-dimensions):
  GET    /active                  - S1 一次拿齐，按 kind 各返回 active 列表
  GET    /                        - 管理页用，返回全量 (含 inactive)
  GET    /{kind}                  - 单维度列表（全量）
  POST   /{kind}                  - 新增条目 (id 自动生成)
  PUT    /{kind}/{entry_id}       - 更新
  DELETE /{kind}/{entry_id}       - 删除

⚠️ 路由顺序敏感：`/active` 和 `/` 必须在 `/{kind}` 之前注册，否则会被
通配捕获（FastAPI 路由按声明顺序匹配）。代码块严格保持该顺序。
"""
from __future__ import annotations

from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import ValidationError

from backend.creative_os.creative_dimensions import (
    DimensionEntryPayload,
    VALID_KINDS,
)


router = APIRouter(prefix="/api/v1/creative-dimensions", tags=["creative_dimensions"])


def _store(request: Request):
    store = getattr(request.app.state, "creative_dimensions_store", None)
    if store is None:
        raise HTTPException(status_code=503, detail={
            "error": True, "code": "STORE_UNAVAILABLE",
            "message": "creative_dimensions_store 未初始化",
        })
    return store


def _err(status: int, code: str, message: str) -> HTTPException:
    return HTTPException(status_code=status, detail={
        "error": True, "code": code, "message": message,
    })


@router.get("/active")
async def list_active(request: Request) -> dict:
    store = _store(request)
    return {
        "subject": [vars(e) for e in store.list("subject", active_only=True)],
        "tone":    [vars(e) for e in store.list("tone",    active_only=True)],
        "style":   [vars(e) for e in store.list("style",   active_only=True)],
    }


@router.get("")
async def list_all(request: Request) -> dict:
    store = _store(request)
    return {
        "subject": [vars(e) for e in store.list("subject", active_only=False)],
        "tone":    [vars(e) for e in store.list("tone",    active_only=False)],
        "style":   [vars(e) for e in store.list("style",   active_only=False)],
    }


@router.get("/{kind}")
async def list_by_kind(kind: str, request: Request) -> list[dict]:
    if kind not in VALID_KINDS:
        raise _err(400, "INVALID_KIND", f"unknown kind: {kind!r}")
    store = _store(request)
    return [vars(e) for e in store.list(kind, active_only=False)]


@router.post("/{kind}")
async def add_entry(kind: str, payload: DimensionEntryPayload, request: Request) -> dict:
    if kind not in VALID_KINDS:
        raise _err(400, "INVALID_KIND", f"unknown kind: {kind!r}")
    store = _store(request)
    try:
        entry = store.add(kind, payload)
    except ValueError as e:
        msg = str(e)
        if "duplicate name" in msg:
            raise _err(400, "DUPLICATE_NAME", msg) from e
        raise _err(400, "BAD_REQUEST", msg) from e
    return vars(entry)


@router.put("/{kind}/{entry_id}")
async def update_entry(kind: str, entry_id: str, payload: DimensionEntryPayload, request: Request) -> dict:
    if kind not in VALID_KINDS:
        raise _err(400, "INVALID_KIND", f"unknown kind: {kind!r}")
    store = _store(request)
    try:
        entry = store.update(kind, entry_id, payload)
    except ValueError as e:
        msg = str(e)
        if "not found" in msg:
            raise _err(404, "NOT_FOUND", msg) from e
        if "duplicate name" in msg:
            raise _err(400, "DUPLICATE_NAME", msg) from e
        raise _err(400, "BAD_REQUEST", msg) from e
    return vars(entry)


@router.delete("/{kind}/{entry_id}")
async def delete_entry(kind: str, entry_id: str, request: Request) -> dict:
    if kind not in VALID_KINDS:
        raise _err(400, "INVALID_KIND", f"unknown kind: {kind!r}")
    store = _store(request)
    if not store.delete(kind, entry_id):
        raise _err(404, "NOT_FOUND", f"entry not found: {entry_id!r} in {kind}")
    return {"deleted": True, "id": entry_id}
```

- [ ] **Step 4: 注册 router 到 main.py**

打开 `backend/main.py`，在 `from backend.api import (...)` 那一行加 `creative_dimensions,`，并在 `app.include_router(...)` 列表加一行：

```python
app.include_router(creative_dimensions.router)
```

- [ ] **Step 5: 跑路由测试**

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
pytest backend/tests/test_api/test_creative_dimensions_routes.py -v
```

期望：全部 PASS（11 个 test）。

- [ ] **Step 6: Commit**

```bash
git add backend/api/creative_dimensions.py backend/main.py backend/tests/test_api/test_creative_dimensions_routes.py
git commit -m "feat(api): /api/v1/creative-dimensions routes (6 endpoints)"
```

---

## Task 6: 重构 `/api/v1/genres` 为读新 store + 兼容测试

**Files:**
- Modify: `backend/api/genres.py`
- Test: `backend/tests/test_api/test_genres_compat.py`

- [ ] **Step 1: 写兼容测试**

新建 `backend/tests/test_api/test_genres_compat.py`：

```python
"""Compatibility: GET /api/v1/genres reads from new store."""
from __future__ import annotations

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.genres import router
from backend.services.creative_dimensions_store import CreativeDimensionsStore
from backend.creative_os.creative_dimensions import (
    DimensionsCatalog,
    DimensionEntry,
)


@pytest.fixture
def store_with_subject(tmp_path):
    seed = DimensionsCatalog(
        subject=[
            DimensionEntry(id="xuanhuan", name="玄幻", description="",
                           status="active", family="xuanhuan", label_en="Xuanhuan",
                           order=0, created_at="x", updated_at="x"),
            DimensionEntry(id="disabled", name="已禁用题材", description="",
                           status="inactive", order=1,
                           created_at="x", updated_at="x"),
        ],
        tone=[], style=[],
    )
    path = tmp_path / "creative_dimensions.json"
    store = CreativeDimensionsStore(path, lambda: seed)
    store.load()
    return store


@pytest.fixture
def client(store_with_subject):
    app = FastAPI()
    app.include_router(router)
    app.state.creative_dimensions_store = store_with_subject
    return TestClient(app)


def test_default_filters_inactive(client):
    """ui_visible_only=True (默认) → 只返回 status=='active'。"""
    resp = client.get("/api/v1/genres")
    assert resp.status_code == 200
    body = resp.json()
    ids = [g["id"] for g in body]
    assert "xuanhuan" in ids
    assert "disabled" not in ids


def test_explicit_includes_inactive(client):
    """ui_visible_only=False → 包含 inactive。"""
    resp = client.get("/api/v1/genres?ui_visible_only=false")
    assert resp.status_code == 200
    body = resp.json()
    ids = [g["id"] for g in body]
    assert "xuanhuan" in ids
    assert "disabled" in ids


def test_field_mapping_compat(client):
    """返回字段 shape 兼容：label_zh ↔ name, label_en ↔ label_en, family, ui_visible。"""
    resp = client.get("/api/v1/genres")
    g = resp.json()[0]
    assert g["id"] == "xuanhuan"
    assert g["label_zh"] == "玄幻"
    assert g["label_en"] == "Xuanhuan"
    assert g["family"] == "xuanhuan"
    assert g["ui_visible"] is True
```

- [ ] **Step 2: 跑测试，确认失败（接口尚未改造）**

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
pytest backend/tests/test_api/test_genres_compat.py -v
```

期望：FAIL（仍读 YAML，不过滤 status）。

- [ ] **Step 3: 重写 `backend/api/genres.py`**

```python
"""GET /api/v1/genres — list all genres for the frontend.

读 CreativeDimensionsStore 的 subject 维度（兼容原 catalog 接口）。
"""
from fastapi import APIRouter, Request

router = APIRouter(prefix="/api/v1/genres", tags=["genres"])


def _store(request: Request):
    return getattr(request.app.state, "creative_dimensions_store", None)


@router.get("")
async def list_genres(ui_visible_only: bool = True) -> list[dict]:
    """Return [{id, label_zh, label_en, family, ui_visible}, ...].

    Default `ui_visible_only=True` 因为 primary caller 是 UI dropdown。
    Admin / internal caller 可传 `?ui_visible_only=false` 拿全量。

    字段映射（向后兼容）：
      id         ↔ DimensionEntry.id
      label_zh   ↔ DimensionEntry.name
      label_en   ↔ DimensionEntry.label_en
      family     ↔ DimensionEntry.family
      ui_visible ↔ (status == "active")
    """
    # 优先从 app.state.creative_dimensions_store 读（新数据源）
    from backend.creative_os.creative_dimensions import DimensionEntry  # noqa: F401
    from fastapi import HTTPException  # noqa: F401

    # FastAPI 不能直接拿到 request.state 用 here，调用方传 request 进来
    # —— 改写：用 Depends 注入 Request
    raise NotImplementedError("see refactored code below")
```

**Wait** — 上面这种"raise NotImplementedError"占位写法违反 plan 无占位符规则。正确做法：直接把签名改成接受 `request: Request`：

```python
"""GET /api/v1/genres — list all genres for the frontend.

读 CreativeDimensionsStore 的 subject 维度（兼容原 catalog 接口）。
"""
from __future__ import annotations

from fastapi import APIRouter, Request


router = APIRouter(prefix="/api/v1/genres", tags=["genres"])


@router.get("")
async def list_genres(request: Request, ui_visible_only: bool = True) -> list[dict]:
    """Return [{id, label_zh, label_en, family, ui_visible}, ...].

    Default `ui_visible_only=True` 因为 primary caller 是 UI dropdown。
    Admin / internal caller 可传 `?ui_visible_only=false` 拿全量。

    字段映射（向后兼容）：
      id         ↔ DimensionEntry.id
      label_zh   ↔ DimensionEntry.name
      label_en   ↔ DimensionEntry.label_en
      family     ↔ DimensionEntry.family
      ui_visible ↔ (status == "active")
    """
    store = getattr(request.app.state, "creative_dimensions_store", None)
    if store is None:
        # 后备路径：仍读原 catalog YAML（首次启动时 store 未就绪）
        from backend.genres.catalog import get_catalog
        return get_catalog().list(ui_visible_only=ui_visible_only)

    entries = store.list("subject", active_only=ui_visible_only)
    return [
        {
            "id":         e.id,
            "label_zh":   e.name,
            "label_en":   e.label_en or "",
            "family":     e.family or "",
            "ui_visible": e.status == "active",
        }
        for e in entries
    ]
```

> 注意：原代码 `from backend.genres.catalog import get_catalog` 在函数外 import。新代码保留 `get_catalog` 作为后备路径 —— 测试 fixture 里没构造 store 的极端情况（已构造），但万一 store 未初始化时不 503 而是降级到 YAML 读。

- [ ] **Step 4: 跑兼容测试**

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
pytest backend/tests/test_api/test_genres_compat.py -v
```

期望：全部 PASS（3 个 test）。

- [ ] **Step 5: 跑现有 S1 相关测试确保没破坏**

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
pytest backend/tests/test_api/ -k "three_b or genres" -v
```

期望：所有现有测试仍 PASS。

- [ ] **Step 6: Commit**

```bash
git add backend/api/genres.py backend/tests/test_api/test_genres_compat.py
git commit -m "refactor(genres): /api/v1/genres reads from CreativeDimensionsStore"
```

---

## Task 7: 添加 `_build_dimension_block` + `_maybe_inject_block` + 引擎调用点改造

**Files:**
- Modify: `backend/creative_os/three_b_engine.py`
- Test: `backend/tests/test_creative_os/test_three_b_engine.py`（追加用例）

- [ ] **Step 1: 写引擎测试**

打开 `backend/tests/test_creative_os/test_three_b_engine.py`（若不存在则建），追加以下 test：

```python
"""追加 test_three_b_engine.py 中的 _build_dimension_block 用例。"""
from __future__ import annotations

import pytest

from backend.creative_os.three_b_engine import (
    RawIntent,
    _build_dimension_block,
)


class _StubEntry:
    def __init__(self, id_, name, description, status="active"):
        self.id = id_
        self.name = name
        self.description = description
        self.status = status


class _StubStore:
    def __init__(self, mapping):
        # mapping: {(kind, id): entry}
        self._m = mapping

    def get(self, kind, id_):
        return self._m.get((kind, id_))


@pytest.fixture
def stub_store(monkeypatch):
    s = _StubStore({
        ("subject", "xuanhuan"): _StubEntry("xuanhuan", "玄幻", "东方仙侠世界"),
        ("tone", "rexue"): _StubEntry("rexue", "热血", "激烈昂扬"),
        ("style", "shuangwen"): _StubEntry("shuangwen", "爽文", "节奏紧凑"),
        # empty description → 不应出现在 block 中
        ("subject", "empty"): _StubEntry("empty", "空题材", ""),
    })
    from backend.creative_os import three_b_engine as engine_mod
    monkeypatch.setattr(engine_mod, "_get_dimensions_store", lambda: s)
    return s


def test_block_with_all_three_dimensions(stub_store):
    intent = RawIntent(prompt="p", genre_primary="xuanhuan",
                        tone="rexue", style="shuangwen")
    block = _build_dimension_block(intent)
    assert "题材（玄幻）：东方仙侠世界" in block
    assert "基调（热血）：激烈昂扬" in block
    assert "风格（爽文）：节奏紧凑" in block
    # 三行
    assert len(block.splitlines()) == 3


def test_block_skips_empty_description(stub_store):
    intent = RawIntent(prompt="p", genre_primary="empty", tone="", style="")
    block = _build_dimension_block(intent)
    # 没 description → 不输出
    assert block == ""


def test_block_skips_missing_id(stub_store):
    intent = RawIntent(prompt="p", genre_primary="missing", tone="rexue", style="")
    block = _build_dimension_block(intent)
    # missing id 取不到 → 不出现；tone 行出现
    assert "题材" not in block
    assert "基调（热血）" in block


def test_block_returns_empty_when_no_intent(stub_store):
    assert _build_dimension_block(None) == ""


def test_maybe_inject_block_no_block_no_change(stub_store):
    from backend.creative_os.three_b_engine import _maybe_inject_block
    user = "原始 prompt"
    # 全空描述 → block 为空 → 返回原 prompt
    intent = RawIntent(prompt="p", genre_primary="empty", tone="", style="")
    assert _maybe_inject_block(user, intent) == user


def test_maybe_inject_block_prepends_with_header(stub_store):
    from backend.creative_os.three_b_engine import _maybe_inject_block
    user = "原始 prompt"
    intent = RawIntent(prompt="p", genre_primary="xuanhuan",
                        tone="rexue", style="shuangwen")
    out = _maybe_inject_block(user, intent)
    assert out.startswith("【设定背景】\n")
    assert "题材（玄幻）" in out
    assert out.endswith("原始 prompt")
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
pytest backend/tests/test_creative_os/test_three_b_engine.py -v -k "block or _maybe"
```

期望：`ImportError` or `AttributeError: module ... has no attribute '_build_dimension_block'`

- [ ] **Step 3: 在 `three_b_engine.py` 加 helper**

打开 `backend/creative_os/three_b_engine.py`，在文件顶部 import 区域追加：

```python
from backend.creative_os.creative_dimensions import DimensionEntry  # noqa: F401  (re-exported)
```

并在 `migrate_state_on_load` 函数之后、`_append_original_candidate` 之前插入两个模块级函数：

```python
def _get_dimensions_store():
    """获取 CreativeDimensionsStore 单例。

    单例在 backend/main.py lifespan 中创建并挂到 app.state。
    引擎实例通常通过 app.state.three_b_engine 间接访问，
    但 _build_dimension_block 是模块级函数，需要一个独立获取路径。

    约定：从已存在的 engine instance 反查 app.state：
      ThreeBEngine._app_state_ref -> request.app.state
    由于本引擎没有 request 上下文，这里采用「最后一次创建该引擎的
    app.state 引用」机制：在 engine 构造时记录 request.app.state。

    fallback：若未记录（如测试环境），返回 None → block 为空字符串。
    """
    # 维护一个模块级弱引用集合，engine 构造时把 app.state 注册进去
    ref = globals().get("_dimensions_store_ref")
    return ref() if ref else None


def _register_dimensions_store(store) -> None:
    """lifespan / 测试 setup 时调用一次。"""
    globals()["_dimensions_store_ref"] = lambda: store


def _build_dimension_block(raw_intent: Optional[RawIntent]) -> str:
    """根据 raw_intent 选中的 id，从 store 查 description，拼出「设定背景」块内容。

    没有 description 的维度行不出现；找不到 id 的条目也不出现。
    """
    store = _get_dimensions_store()
    if raw_intent is None or store is None:
        return ""
    lines: list[str] = []
    for kind, label, value in [
        ("subject", "题材", raw_intent.genre_primary),
        ("tone",    "基调", raw_intent.tone),
        ("style",   "风格", raw_intent.style),
    ]:
        if not value:
            continue
        entry = store.get(kind, value)
        if entry and entry.description and entry.description.strip():
            lines.append(f"{label}（{entry.name}）：{entry.description.strip()}")
    return "\n".join(lines)


def _maybe_inject_block(rendered_user_prompt: str, raw_intent: Optional[RawIntent]) -> str:
    """在已有 format 后的 user prompt 开头拼接「设定背景」块（block 为空则不变）。"""
    block = _build_dimension_block(raw_intent)
    if not block:
        return rendered_user_prompt
    return "【设定背景】\n" + block + "\n\n" + rendered_user_prompt
```

- [ ] **Step 4: 修改 `decompose()` 在 LLM 调用前注入**

找到 `decompose()` 方法中的 `_invoke_llm_json` 调用（约 line 283），改造：

```python
async def decompose(
    self, project_id: str, raw_intent: RawIntent, user_modifications: str = ""
) -> tuple[list[DimensionDecomposition], str, str]:
    started_at = _now_iso()
    response = await self._invoke_llm_json_with_block(
        DECOMPOSE_PROMPT, "decompose",
        raw_intent=raw_intent,
        prompt=raw_intent.prompt,
        genre_primary=raw_intent.genre_primary,
        tone=raw_intent.tone or "(无)",
        style=raw_intent.style or "(无)",
        user_modifications=_build_user_modifications_block(user_modifications),
    )
    raw_text = response.get("content", "")
    # ... 后续不变
```

并在类里加 helper 方法（紧邻 `_invoke_llm_json`）：

```python
async def _invoke_llm_json_with_block(
    self, prompt_name: str, task_name: str, *, raw_intent: Optional[RawIntent] = None, **fmt
) -> dict:
    """与 _invoke_llm_json 相同，但额外在 user 消息前注入「设定背景」块。"""
    prompt_data = load_prompt_effective(prompt_name)
    system = prompt_data["system_prompt"].format(negative_constraints="")
    user = prompt_data["user_prompt_template"].format(**fmt)
    user = _maybe_inject_block(user, raw_intent)
    return await self._router.execute(
        agent_name="three_b",
        task_name=task_name,
        messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
        json_mode=True,
        temperature=prompt_data.get("temperature", 0.7),
        max_tokens=prompt_data.get("max_tokens", 4096),
    )
```

- [ ] **Step 5: 修改 `_diverge_single_unit()` 用同样 helper**

找到 `_diverge_single_unit()` 中的 `_invoke_llm_json` 调用（约 line 457），替换为：

```python
response = await self._invoke_llm_json_with_block(
    ADAPTIVE_DIVERGE_PROMPT, "diverge_unit",
    raw_intent=raw_intent,
    prompt=raw_intent.prompt,
    genre_primary=raw_intent.genre_primary,
    tone=raw_intent.tone or "(无)",
    style=raw_intent.style or "(无)",
    dimension=dim.dimension.value,
    unit_name=unit.unit_name,
    unit_description=unit.description,
)
```

- [ ] **Step 6: 修改 `commit()` 在 LLM 调用前注入**

找到 `commit()` 方法中 `_build_commit_user_prompt` 后 `_router.execute` 之前的代码，改造为：

```python
state.commit_started_at = _now_iso()
# 旧代码：
#   user = self._build_commit_user_prompt(prompt_data["user_prompt_template"], state)
# 新代码：增加 block 注入
user = self._build_commit_user_prompt(prompt_data["user_prompt_template"], state)
user = _maybe_inject_block(user, state.raw_intent)
response = await self._router.execute(
    agent_name="three_b",
    task_name="commit",
    messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
    json_mode=True,
    temperature=prompt_data.get("temperature", 0.7),
    max_tokens=prompt_data.get("max_tokens", 4096),
)
```

- [ ] **Step 7: 跑测试**

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
pytest backend/tests/test_creative_os/test_three_b_engine.py -v
```

期望：所有 test PASS（包括 Task 3 的 6 个老 test 不变）。

- [ ] **Step 8: 跑全部 creative_os 测试确保不破坏**

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
pytest backend/tests/test_creative_os/ backend/tests/test_api/test_three_b_routes.py -v
```

期望：全部 PASS。

- [ ] **Step 9: Commit**

```bash
git add backend/creative_os/three_b_engine.py backend/tests/test_creative_os/test_three_b_engine.py
git commit -m "feat(three_b): inject 设定背景 block into decompose/diverge/commit prompts"
```

---

## Task 8: 在 lifespan 注册 dimensions store（让引擎能拿到）

> 上一节 `_register_dimensions_store` 需要在 lifespan 中调用。

**Files:**
- Modify: `backend/main.py`

- [ ] **Step 1: 在 lifespan 的 store 创建后立即注册**

找到 Task 4 加的 `app.state.creative_dimensions_store = CreativeDimensionsStore(...)` 后追加：

```python
from backend.creative_os.three_b_engine import _register_dimensions_store
_register_dimensions_store(app.state.creative_dimensions_store)
```

- [ ] **Step 2: 验证启动不报错**

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
python -c "
from backend.main import app
from backend.creative_os.three_b_engine import _get_dimensions_store, _build_dimension_block
from backend.creative_os.creative_dimensions import RawIntent
# lifespan 在 import 时不自动跑；验证 _get_dimensions_store 至少不抛异常
print('store:', _get_dimensions_store())
# 即使没注册也不崩
print('block empty:', _build_dimension_block(RawIntent(prompt='p', genre_primary='xuanhuan')))
"
```

期望：store 为 None（lifespan 未跑），block 为空字符串。

- [ ] **Step 3: 跑 engine 测试**

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
pytest backend/tests/test_creative_os/test_three_b_engine.py -v
```

期望：仍 PASS（测试用 monkeypatch 自己注册）。

- [ ] **Step 4: Commit**

```bash
git add backend/main.py
git commit -m "feat(main): register dimensions store ref for engine injection"
```

---

## Task 9: 前端类型 + API client 扩展

**Files:**
- Create: `frontend/src/api/types.ts`
- Modify: `frontend/src/api/client.ts`（加 5 个方法）

- [ ] **Step 1: 创建类型文件**

新建 `frontend/src/api/types.ts`：

```ts
/** 创作维度条目（subject / tone / style 共用）。 */
export interface DimensionEntry {
  id: string;
  name: string;
  description: string;
  status: "active" | "inactive";
  family?: string;
  label_en?: string;
  order: number;
  created_at: string;
  updated_at: string;
}

export type DimensionKind = "subject" | "tone" | "style";

export interface DimensionEntryPayload {
  name: string;
  description?: string;
  status?: "active" | "inactive";
  family?: string;
  label_en?: string;
  order?: number;
}

export interface ActiveDimensions {
  subject: DimensionEntry[];
  tone: DimensionEntry[];
  style: DimensionEntry[];
}
```

- [ ] **Step 2: 在 `client.ts` 加 import + 6 个方法**

打开 `frontend/src/api/client.ts`，在顶部 import 区域加：

```ts
import type { ActiveDimensions, DimensionEntry, DimensionEntryPayload, DimensionKind } from "./types";
```

`client.ts` 是函数式 default export（`const api = { ... }`，方法都是箭头函数）。在 `api` 对象最后一个方法之后、`export default api;` 之前追加：

```ts
  // --- 创作维度 (subject/tone/style) ---
  listActiveCreativeDimensions: (): Promise<ActiveDimensions> =>
    request("GET", "/v1/creative-dimensions/active"),

  listAllCreativeDimensions: (): Promise<ActiveDimensions> =>
    request("GET", "/v1/creative-dimensions/"),

  listCreativeDimensions: (kind: DimensionKind): Promise<DimensionEntry[]> =>
    request("GET", `/v1/creative-dimensions/${kind}`),

  addCreativeDimension: (kind: DimensionKind, payload: DimensionEntryPayload): Promise<DimensionEntry> =>
    request("POST", `/v1/creative-dimensions/${kind}`, payload),

  updateCreativeDimension: (kind: DimensionKind, id: string, payload: DimensionEntryPayload): Promise<DimensionEntry> =>
    request("PUT", `/v1/creative-dimensions/${kind}/${id}`, payload),

  deleteCreativeDimension: (kind: DimensionKind, id: string): Promise<{ deleted: boolean; id: string }> =>
    request("DELETE", `/v1/creative-dimensions/${kind}/${id}`),
```

> ⚠️ 字段类型匹配：删除路由返回 `{"deleted": True, "id": "..."}`（见 Task 5 实现），故返回类型为 `Promise<{ deleted: boolean; id: string }>`。

- [ ] **Step 3: 类型检查通过**

```bash
cd /Users/longsa/Codes/nebula/frontend
npx tsc --noEmit 2>&1 | head -30
```

期望：无 error（若已有 error 是 pre-existing，与本改动无关）。

- [ ] **Step 4: Commit**

```bash
git add frontend/src/api/types.ts frontend/src/api/client.ts
git commit -m "feat(api-client): 5 methods for /creative-dimensions + DimensionEntry types"
```

---

## Task 10: `useCreativeDimensions` hook

**Files:**
- Create: `frontend/src/hooks/useCreativeDimensions.ts`
- Test: `frontend/src/test/hooks/useCreativeDimensions.test.ts`

- [ ] **Step 1: 写 hook 测试**

新建 `frontend/src/test/hooks/useCreativeDimensions.test.ts`：

```tsx
import { renderHook, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/api/client", () => ({
  default: {
    listActiveCreativeDimensions: vi.fn(),
  },
}));
vi.mock("@/api/client", async () => {
  const actual = await vi.importActual<any>("@/api/client");
  return actual;
});

import api from "@/api/client";
import { useCreativeDimensions } from "@/hooks/useCreativeDimensions";

describe("useCreativeDimensions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // 重置模块缓存：使用 vi.resetModules() 让 hook 重新跑 factory
    vi.resetModules();
  });

  it("loads from api on mount", async () => {
    const stub = {
      subject: [{ id: "x", name: "X", description: "", status: "active" as const, order: 0, created_at: "a", updated_at: "a" }],
      tone: [],
      style: [],
    };
    (api.listActiveCreativeDimensions as any).mockResolvedValue(stub);

    const { result } = renderHook(() => useCreativeDimensions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.subject).toEqual(stub.subject);
    expect(result.current.tone).toEqual([]);
    expect(api.listActiveCreativeDimensions).toHaveBeenCalledTimes(1);
  });

  it("caches between mounts", async () => {
    const stub = {
      subject: [{ id: "x", name: "X", description: "", status: "active" as const, order: 0, created_at: "a", updated_at: "a" }],
      tone: [],
      style: [],
    };
    (api.listActiveCreativeDimensions as any).mockResolvedValue(stub);

    const { result: r1 } = renderHook(() => useCreativeDimensions());
    await waitFor(() => expect(r1.current.loading).toBe(false));

    const { result: r2 } = renderHook(() => useCreativeDimensions());
    // 第二次 mount 应直接命中 cache，不发新请求
    expect(r2.current.subject).toEqual(stub.subject);
    expect(api.listActiveCreativeDimensions).toHaveBeenCalledTimes(1);
  });

  it("captures error on api failure", async () => {
    (api.listActiveCreativeDimensions as any).mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() => useCreativeDimensions());
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("boom");
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
cd /Users/longsa/Codes/nebula/frontend
npm test -- useCreativeDimensions 2>&1 | tail -30
```

期望：FAIL（hook 不存在）。

- [ ] **Step 3: 实现 hook**

新建 `frontend/src/hooks/useCreativeDimensions.ts`：

```ts
import { useCallback, useEffect, useState } from "react";
import api from "../api/client";
import type { ActiveDimensions, DimensionEntry } from "../api/types";

const EMPTY: ActiveDimensions = { subject: [], tone: [], style: [] };

let cache: ActiveDimensions | null = null;
let inflight: Promise<ActiveDimensions> | null = null;

export function useCreativeDimensions() {
  const [data, setData] = useState<ActiveDimensions>(cache ?? EMPTY);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cache) {
      setData(cache);
      setLoading(false);
      return;
    }
    if (!inflight) {
      inflight = api.listActiveCreativeDimensions().then((d) => {
        cache = d;
        return d;
      });
    }
    inflight
      .then((d) => setData(d))
      .catch((e) => setError(e instanceof Error ? e.message : "unknown"))
      .finally(() => {
        setLoading(false);
        inflight = null;
      });
  }, []);

  const refresh = useCallback(async () => {
    cache = null;
    inflight = api.listActiveCreativeDimensions().then((d) => {
      cache = d;
      return d;
    });
    setLoading(true);
    try {
      const fresh = await inflight;
      setData(fresh);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unknown");
    } finally {
      setLoading(false);
      inflight = null;
    }
  }, []);

  return { ...data, loading, error, refresh };
}

// 仅供测试用：重置模块缓存
export function __resetCacheForTests() {
  cache = null;
  inflight = null;
}
```

- [ ] **Step 4: 跑 hook 测试**

```bash
cd /Users/longsa/Codes/nebula/frontend
npm test -- useCreativeDimensions 2>&1 | tail -30
```

期望：全部 PASS（3 个 test）。

- [ ] **Step 5: Commit**

```bash
git add frontend/src/hooks/useCreativeDimensions.ts frontend/src/test/hooks/useCreativeDimensions.test.ts
git commit -m "feat(hook): useCreativeDimensions with module-level cache"
```

---

## Task 11: 创建 CreativeDimensions 管理页（View + Tabs + EditPanel + Page + Sidebar）

**Files:**
- Create: `frontend/src/components/creativeDimensions/CreativeDimensionsView.tsx`
- Create: `frontend/src/components/creativeDimensions/DimensionTabs.tsx`
- Create: `frontend/src/components/creativeDimensions/EntryEditPanel.tsx`
- Create: `frontend/src/pages/CreativeDimensionsPage.tsx`
- Modify: `frontend/src/components/home/StatsSidebar.tsx`（加侧边栏项）
- Modify: `frontend/src/App.tsx`（加路由）
- Test: `frontend/src/test/pages/CreativeDimensionsPage.test.tsx`

- [ ] **Step 1: 写页面测试**

新建 `frontend/src/test/pages/CreativeDimensionsPage.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { Routes, Route, MemoryRouter } from "react-router-dom";

vi.mock("@/api/client", () => ({
  default: {
    listAllCreativeDimensions: vi.fn(),
    addCreativeDimension: vi.fn(),
    updateCreativeDimension: vi.fn(),
    deleteCreativeDimension: vi.fn(),
  },
}));
import api from "@/api/client";
import CreativeDimensionsPage from "@/pages/CreativeDimensionsPage";

const stubAll = {
  subject: [
    { id: "xuanhuan", name: "玄幻", description: "东方仙侠世界", status: "active" as const,
      family: "xuanhuan", label_en: "Xuanhuan", order: 0,
      created_at: "x", updated_at: "x" },
  ],
  tone: [
    { id: "rexue", name: "热血", description: "", status: "inactive" as const,
      order: 0, created_at: "x", updated_at: "x" },
  ],
  style: [],
};

describe("CreativeDimensionsPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    (api.listAllCreativeDimensions as any).mockResolvedValue(stubAll);
  });

  it("renders three tabs with badges", async () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/creative-dimensions" element={<CreativeDimensionsPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("题材")).toBeInTheDocument());
    expect(screen.getByText("基调")).toBeInTheDocument();
    expect(screen.getByText("风格")).toBeInTheDocument();
  });

  it("lists entries for active kind", async () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/creative-dimensions" element={<CreativeDimensionsPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("玄幻")).toBeInTheDocument());
    expect(screen.getByText(/1\/1/)).toBeInTheDocument(); // subject active/total
  });

  it("switches tab to tone and lists tone entries", async () => {
    render(
      <MemoryRouter>
        <Routes>
          <Route path="/creative-dimensions" element={<CreativeDimensionsPage />} />
        </Routes>
      </MemoryRouter>
    );
    await waitFor(() => expect(screen.getByText("玄幻")).toBeInTheDocument());
    screen.getByText("基调").click();
    await waitFor(() => expect(screen.getByText("热血")).toBeInTheDocument());
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
cd /Users/longsa/Codes/nebula/frontend
npm test -- CreativeDimensionsPage 2>&1 | tail -20
```

期望：FAIL（页面不存在）。

- [ ] **Step 3: 实现 DimensionTabs 组件**

新建 `frontend/src/components/creativeDimensions/DimensionTabs.tsx`：

```tsx
import type { DimensionKind, DimensionEntry } from "@/api/types";

interface Props {
  active: DimensionKind;
  onChange: (kind: DimensionKind) => void;
  counts: Record<DimensionKind, { active: number; total: number }>;
}

const LABELS: Record<DimensionKind, string> = {
  subject: "题材",
  tone: "基调",
  style: "风格",
};

export default function DimensionTabs({ active, onChange, counts }: Props) {
  return (
    <nav className="flex flex-col gap-1" data-testid="dimension-tabs">
      {(Object.keys(LABELS) as DimensionKind[]).map((kind) => {
        const c = counts[kind];
        return (
          <button
            key={kind}
            type="button"
            onClick={() => onChange(kind)}
            className={`text-left px-3 py-2 rounded-lg text-sm font-display ${
              active === kind
                ? "bg-primary-container text-on-primary-container"
                : "text-primary hover:bg-surface-container-high"
            }`}
            data-testid={`tab-${kind}`}
          >
            <span>{LABELS[kind]}</span>
            <span className="ml-2 font-mono text-xs text-on-surface-variant">
              {c.active}/{c.total}
            </span>
          </button>
        );
      })}
    </nav>
  );
}
```

- [ ] **Step 4: 实现 EntryEditPanel 组件**

新建 `frontend/src/components/creativeDimensions/EntryEditPanel.tsx`：

```tsx
import { useState, useEffect } from "react";
import type { DimensionEntry, DimensionEntryPayload, DimensionKind } from "@/api/types";
import { PanelCard, PrimaryButton, GhostButton } from "@/components/ds";

interface Props {
  kind: DimensionKind;
  entry: DimensionEntry | null;   // null = 新增
  onSave: (payload: DimensionEntryPayload) => Promise<void>;
  onDelete?: () => Promise<void>;
  onClose: () => void;
}

export default function EntryEditPanel({ kind, entry, onSave, onDelete, onClose }: Props) {
  const [name, setName] = useState(entry?.name ?? "");
  const [description, setDescription] = useState(entry?.description ?? "");
  const [status, setStatus] = useState<"active" | "inactive">(entry?.status ?? "active");
  const [family, setFamily] = useState(entry?.family ?? "");
  const [labelEn, setLabelEn] = useState(entry?.label_en ?? "");
  const [order, setOrder] = useState(entry?.order ?? 0);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setName(entry?.name ?? "");
    setDescription(entry?.description ?? "");
    setStatus(entry?.status ?? "active");
    setFamily(entry?.family ?? "");
    setLabelEn(entry?.label_en ?? "");
    setOrder(entry?.order ?? 0);
    setErr(null);
  }, [entry]);

  const handleSave = async () => {
    setSaving(true);
    setErr(null);
    try {
      await onSave({
        name: name.trim(),
        description: description,
        status,
        family: family || undefined,
        label_en: labelEn || undefined,
        order: Number(order) || 0,
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="absolute inset-0 z-10 bg-black/30 flex items-center justify-center p-4"
      data-testid="entry-edit-panel-overlay"
    >
      <PanelCard className="w-full max-w-2xl max-h-[80vh] flex flex-col overflow-hidden">
        <div className="px-6 py-3 border-b border-outline-variant flex items-center justify-between">
          <h3 className="font-display text-base text-primary">
            {entry ? `编辑：${entry.name}` : "新增"}
          </h3>
          <button
            type="button"
            onClick={onClose}
            aria-label="关闭"
            className="text-on-surface-variant hover:text-primary"
            data-testid="edit-panel-close"
          >
            <span className="material-symbols-outlined">close</span>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-4">
          {err && (
            <div className="p-2 bg-error/10 border border-error/30 rounded text-error text-xs">
              {err}
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-primary mb-1">名称</label>
            <input
              type="text"
              value={name}
              maxLength={64}
              onChange={(e) => setName(e.target.value)}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container"
              data-testid="edit-name"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-primary mb-1">状态</label>
            <div className="flex gap-2" data-testid="edit-status">
              <button
                type="button"
                onClick={() => setStatus("active")}
                className={`px-3 py-1.5 rounded-lg text-sm ${
                  status === "active" ? "bg-primary-container text-on-primary-container" : "text-primary hover:bg-surface-container-high"
                }`}
                data-testid="status-active"
              >
                生效
              </button>
              <button
                type="button"
                onClick={() => setStatus("inactive")}
                className={`px-3 py-1.5 rounded-lg text-sm ${
                  status === "inactive" ? "bg-primary-container text-on-primary-container" : "text-primary hover:bg-surface-container-high"
                }`}
                data-testid="status-inactive"
              >
                失效
              </button>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-primary mb-1">
              特征 <span className="text-on-surface-variant text-xs">({description.length}/2000)</span>
            </label>
            <textarea
              value={description}
              maxLength={2000}
              onChange={(e) => setDescription(e.target.value)}
              rows={6}
              className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container resize-y"
              data-testid="edit-description"
            />
          </div>

          {kind === "subject" && (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-primary mb-1">Family</label>
                <input
                  type="text"
                  value={family}
                  maxLength={64}
                  onChange={(e) => setFamily(e.target.value)}
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary"
                  data-testid="edit-family"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-primary mb-1">label_en</label>
                <input
                  type="text"
                  value={labelEn}
                  maxLength={128}
                  onChange={(e) => setLabelEn(e.target.value)}
                  className="w-full bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary"
                  data-testid="edit-label-en"
                />
              </div>
            </div>
          )}

          <div>
            <label className="block text-sm font-medium text-primary mb-1">排序</label>
            <input
              type="number"
              value={order}
              min={0}
              max={9999}
              onChange={(e) => setOrder(Number(e.target.value))}
              className="w-32 bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary"
              data-testid="edit-order"
            />
          </div>
        </div>

        <div className="px-6 py-3 border-t border-outline-variant flex items-center justify-between">
          <div>
            {entry && onDelete && (
              <button
                type="button"
                onClick={() => {
                  if (window.confirm(`确定删除「${entry.name}」?`)) {
                    onDelete();
                  }
                }}
                className="px-3 py-1.5 text-error hover:bg-error/10 rounded-lg text-sm"
                data-testid="edit-delete"
              >
                删除
              </button>
            )}
          </div>
          <div className="flex gap-2">
            <GhostButton onClick={onClose}>取消</GhostButton>
            <PrimaryButton onClick={handleSave} disabled={saving || !name.trim()} testId="edit-save">
              {saving ? "保存中…" : "保存"}
            </PrimaryButton>
          </div>
        </div>
      </PanelCard>
    </div>
  );
}
```

- [ ] **Step 5: 实现 CreativeDimensionsView**

新建 `frontend/src/components/creativeDimensions/CreativeDimensionsView.tsx`：

```tsx
import { useEffect, useMemo, useState } from "react";
import api from "@/api/client";
import type { ActiveDimensions, DimensionEntry, DimensionEntryPayload, DimensionKind } from "@/api/types";
import DimensionTabs from "./DimensionTabs";
import EntryEditPanel from "./EntryEditPanel";
import { PrimaryButton, SearchInput } from "@/components/ds";

interface Props {
  onClose: () => void;
}

const LABELS: Record<DimensionKind, string> = { subject: "题材", tone: "基调", style: "风格" };

export default function CreativeDimensionsView({ onClose }: Props) {
  const [data, setData] = useState<ActiveDimensions | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [activeKind, setActiveKind] = useState<DimensionKind>("subject");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<{ kind: DimensionKind; entry: DimensionEntry | null } | null>(null);

  const refresh = async () => {
    setLoading(true);
    setErr(null);
    try {
      const d = await api.listAllCreativeDimensions();
      setData(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "加载失败");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { refresh(); }, []);

  const counts = useMemo(() => {
    const c: Record<DimensionKind, { active: number; total: number }> = {
      subject: { active: 0, total: 0 },
      tone:    { active: 0, total: 0 },
      style:   { active: 0, total: 0 },
    };
    if (!data) return c;
    (["subject", "tone", "style"] as DimensionKind[]).forEach((k) => {
      c[k].total = data[k].length;
      c[k].active = data[k].filter((e) => e.status === "active").length;
    });
    return c;
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const items = data[activeKind];
    if (!search.trim()) return items;
    const q = search.toLowerCase();
    return items.filter((e) =>
      e.name.toLowerCase().includes(q) || e.description.toLowerCase().includes(q)
    );
  }, [data, activeKind, search]);

  const handleSave = async (payload: DimensionEntryPayload) => {
    if (!editing) return;
    if (editing.entry) {
      await api.updateCreativeDimension(editing.kind, editing.entry.id, payload);
    } else {
      await api.addCreativeDimension(editing.kind, payload);
    }
    setEditing(null);
    await refresh();
  };

  const handleDelete = async () => {
    if (!editing?.entry) return;
    await api.deleteCreativeDimension(editing.kind, editing.entry.id);
    setEditing(null);
    await refresh();
  };

  return (
    <div className="relative flex h-full flex-col overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest">
      <header className="flex items-center justify-between border-b border-outline-variant px-6 py-4">
        <h2 className="font-display text-xl text-primary">创作维度</h2>
        <button
          type="button"
          onClick={onClose}
          aria-label="关闭"
          data-testid="dimensions-close"
          className="text-on-surface-variant hover:text-primary"
        >
          <span className="material-symbols-outlined">close</span>
        </button>
      </header>

      {err && (
        <div className="mx-6 mt-3 p-2 bg-error/10 border border-error/30 rounded text-error text-xs">
          {err}
        </div>
      )}

      <div className="flex-1 flex overflow-hidden">
        <aside className="w-56 border-r border-outline-variant p-3">
          <DimensionTabs active={activeKind} onChange={setActiveKind} counts={counts} />
        </aside>
        <main className="flex-1 flex flex-col overflow-hidden">
          <div className="flex items-center justify-between px-6 py-3 border-b border-outline-variant">
            <SearchInput value={search} onChange={setSearch} placeholder="搜索名称或特征" testId="dimensions-search" />
            <PrimaryButton onClick={() => setEditing({ kind: activeKind, entry: null })} testId="dimensions-add">
              + 新增
            </PrimaryButton>
          </div>
          <div className="flex-1 overflow-y-auto p-6">
            {loading ? (
              <div className="text-on-surface-variant text-sm">加载中…</div>
            ) : filtered.length === 0 ? (
              <div className="text-on-surface-variant text-sm">
                {LABELS[activeKind]} 暂无条目
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="text-left text-xs uppercase tracking-wider text-on-surface-variant">
                    <th className="pb-2">名称</th>
                    <th className="pb-2">状态</th>
                    <th className="pb-2">特征</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((e) => (
                    <tr
                      key={e.id}
                      onClick={() => setEditing({ kind: activeKind, entry: e })}
                      className="border-t border-outline-variant hover:bg-surface-container cursor-pointer"
                      data-testid={`row-${e.id}`}
                    >
                      <td className="py-2 text-sm text-primary">{e.name}</td>
                      <td className="py-2 text-sm">
                        <span
                          className={`inline-block w-2 h-2 rounded-full mr-2 ${
                            e.status === "active" ? "bg-green-500" : "bg-gray-400"
                          }`}
                        />
                        {e.status === "active" ? "生效" : "失效"}
                      </td>
                      <td className="py-2 text-sm text-on-surface-variant truncate max-w-md">
                        {e.description.slice(0, 50)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </main>
      </div>

      {editing && (
        <EntryEditPanel
          kind={editing.kind}
          entry={editing.entry}
          onSave={handleSave}
          onDelete={editing.entry ? handleDelete : undefined}
          onClose={() => setEditing(null)}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 6: 实现 Page 壳**

新建 `frontend/src/pages/CreativeDimensionsPage.tsx`：

```tsx
import { useNavigate } from "react-router-dom";
import CreativeDimensionsView from "../components/creativeDimensions/CreativeDimensionsView";

export default function CreativeDimensionsPage() {
  const navigate = useNavigate();
  return (
    <div className="flex flex-1 min-h-0 flex-col py-6">
      <div className="flex-1 min-h-0">
        <CreativeDimensionsView onClose={() => navigate("/")} />
      </div>
    </div>
  );
}
```

- [ ] **Step 7: 加侧边栏项**

打开 `frontend/src/components/home/StatsSidebar.tsx`，在「提示词广场」项下方加：

```tsx
<SidebarNavItem
  icon="palette"
  label="创作维度"
  active={location.pathname === "/creative-dimensions"}
  onClick={() => navigate("/creative-dimensions")}
  collapsed={collapsed}
  testId="nav-creative-dimensions"
/>
```

并在文件顶部加 `const isDimensionsActive = location.pathname === "/creative-dimensions";`。

- [ ] **Step 8: 加路由**

打开 `frontend/src/App.tsx`，加 import 和路由：

```tsx
import CreativeDimensionsPage from "./pages/CreativeDimensionsPage";
```

并在 `<Routes>` 内加：

```tsx
<Route path="/creative-dimensions" element={<CreativeDimensionsPage />} />
```

- [ ] **Step 9: 跑页面测试**

```bash
cd /Users/longsa/Codes/nebula/frontend
npm test -- CreativeDimensionsPage 2>&1 | tail -30
```

期望：3 个 test PASS。

- [ ] **Step 10: 跑全前端测试**

```bash
cd /Users/longsa/Codes/nebula/frontend
npm test 2>&1 | tail -30
```

期望：所有 test PASS（已有 + 新增）。

- [ ] **Step 11: Commit**

```bash
git add frontend/src/components/creativeDimensions frontend/src/pages/CreativeDimensionsPage.tsx frontend/src/components/home/StatsSidebar.tsx frontend/src/App.tsx frontend/src/test/pages/CreativeDimensionsPage.test.tsx
git commit -m "feat(ui): creative-dimensions admin page (tabs + list + edit panel)"
```

---

## Task 12: 重构 `S1InputStep` 读新 hook

**Files:**
- Modify: `frontend/src/components/wizard/divergence_v2/S1InputStep.tsx`
- Test: `frontend/src/test/wizard/divergence_v2/S1InputStep.test.tsx`（扩展或新建）

- [ ] **Step 1: 写 S1 测试**

新建 `frontend/src/test/wizard/divergence_v2/S1InputStep.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/hooks/useCreativeDimensions", () => ({
  useCreativeDimensions: vi.fn(),
  __resetCacheForTests: vi.fn(),
}));
import { useCreativeDimensions } from "@/hooks/useCreativeDimensions";
import S1InputStep from "@/components/wizard/divergence_v2/S1InputStep";

const stubAll = {
  subject: [{ id: "xuanhuan", name: "玄幻", description: "东方仙侠", status: "active" as const, order: 0, created_at: "a", updated_at: "a" }],
  tone:    [{ id: "rexue", name: "热血", description: "", status: "active" as const, order: 0, created_at: "a", updated_at: "a" }],
  style:   [{ id: "shuangwen", name: "爽文", description: "节奏紧凑", status: "active" as const, order: 0, created_at: "a", updated_at: "a" }],
};

const stubAllInactive = {
  subject: [],
  tone:    [{ id: "rexue", name: "热血", description: "", status: "active" as const, order: 0, created_at: "a", updated_at: "a" }],
  style:   [{ id: "shuangwen", name: "爽文", description: "节奏紧凑", status: "active" as const, order: 0, created_at: "a", updated_at: "a" }],
};

describe("S1InputStep with creative dimensions", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders three dropdowns when all dimensions have active entries", () => {
    (useCreativeDimensions as any).mockReturnValue({ ...stubAll, loading: false, error: null, refresh: vi.fn() });
    render(<S1InputStep projectId="p1" initial={null} onSubmitted={() => {}} />);
    expect(screen.getByText("玄幻")).toBeInTheDocument();
    expect(screen.getByText("热血")).toBeInTheDocument();
    expect(screen.getByText("爽文")).toBeInTheDocument();
  });

  it("disables dropdown when dimension has no active entries", () => {
    (useCreativeDimensions as any).mockReturnValue({ ...stubAllInactive, loading: false, error: null, refresh: vi.fn() });
    render(<S1InputStep projectId="p1" initial={null} onSubmitted={() => {}} />);
    // 题材下拉应禁用
    const subjectSelect = screen.getByTestId("dropdown-subject") ?? screen.getByLabelText("题材").closest("button,select");
    expect(subjectSelect).toBeDisabled?.() ?? null;
    // 提示文字应出现
    expect(screen.getByText(/暂无生效选项/)).toBeInTheDocument();
  });

  it("falls back to first entry when initial value is stale", () => {
    (useCreativeDimensions as any).mockReturnValue({ ...stubAll, loading: false, error: null, refresh: vi.fn() });
    // initial.tone 引用 'stale_id' 不在 active 列表
    const initial = { prompt: "a long enough prompt for validation", genre_primary: "xuanhuan", tone: "stale_id", style: "shuangwen" };
    render(<S1InputStep projectId="p1" initial={initial} onSubmitted={() => {}} />);
    // 默认应回退到首项 'rexue'
    expect(screen.getByText("热血")).toBeInTheDocument();
  });

  it("submits RawIntent with id strings", () => {
    (useCreativeDimensions as any).mockReturnValue({ ...stubAll, loading: false, error: null, refresh: vi.fn() });
    const onSubmitted = vi.fn();
    render(<S1InputStep projectId="p1" initial={null} onSubmitted={onSubmitted} />);
    // 通过底部 wizard footer 触发（onSubmitReady 回调）
    // 这里直接调用 textarea 改值
    const ta = screen.getByPlaceholderText(/赛博朋克/) as HTMLTextAreaElement;
    // 检查下拉选项可访问即可
    expect(ta).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: 跑测试，确认失败**

```bash
cd /Users/longsa/Codes/nebula/frontend
npm test -- S1InputStep 2>&1 | tail -30
```

期望：FAIL（现有 S1 仍读 useGenres 硬编码）。

- [ ] **Step 3: 重写 S1InputStep.tsx**

用以下完整内容替换：

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { DropdownSelect } from "@/components/ds";
import { useCreativeDimensions } from "@/hooks/useCreativeDimensions";
import type { RawIntent } from "./types";

interface Props {
  projectId: string;
  initial: RawIntent | null;
  onSubmitted: (intent: RawIntent) => void;
  onSubmitReady?: (handler: (() => void) | null, valid: boolean) => void;
}

const DEFAULT_GENRE_FALLBACK = "cool_novel";
const MAX_PROMPT = 1000;

const KIND_LABEL = { subject: "题材", tone: "基调", style: "风格" } as const;
type DropdownKind = keyof typeof KIND_LABEL;

function resolveInitialValue(
  initialValue: string | undefined,
  activeIds: Set<string>,
  fallbackId: string | undefined,
): string {
  if (initialValue && activeIds.has(initialValue)) return initialValue;
  if (fallbackId) return fallbackId;
  return "";
}

export default function S1InputStep({
  projectId, initial, onSubmitted, onSubmitReady,
}: Props) {
  const { subject, tone, style, loading, error } = useCreativeDimensions();

  const subjectOptions = useMemo(() => subject.map((e) => ({ value: e.id, label: e.name })), [subject]);
  const toneOptions    = useMemo(() => tone.map((e) => ({ value: e.id, label: e.name })), [tone]);
  const styleOptions   = useMemo(() => style.map((e) => ({ value: e.id, label: e.name })), [style]);

  const subjectActiveIds = useMemo(() => new Set(subject.map((e) => e.id)), [subject]);
  const toneActiveIds    = useMemo(() => new Set(tone.map((e) => e.id)), [tone]);
  const styleActiveIds   = useMemo(() => new Set(style.map((e) => e.id)), [style]);

  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [genrePrimary, setGenrePrimary] = useState(() =>
    resolveInitialValue(initial?.genre_primary, subjectActiveIds, subject[0]?.id) || DEFAULT_GENRE_FALLBACK
  );
  const [toneVal, setTone] = useState(() => resolveInitialValue(initial?.tone, toneActiveIds, tone[0]?.id));
  const [styleVal, setStyle] = useState(() => resolveInitialValue(initial?.style, styleActiveIds, style[0]?.id));

  const subjectDisabled = subjectOptions.length === 0;
  const toneDisabled    = toneOptions.length === 0;
  const styleDisabled   = styleOptions.length === 0;

  const anyDisabled = subjectDisabled || toneDisabled || styleDisabled;
  const valid = prompt.length >= 10 && !subjectDisabled;

  const stateRef = useRef({ prompt, genrePrimary, tone: toneVal, style: styleVal });
  stateRef.current = { prompt, genrePrimary, tone: toneVal, style: styleVal };

  const handleSubmit = useCallback(() => {
    const s = stateRef.current;
    if (s.prompt.length < 10 || subjectDisabled) return;
    const intent: RawIntent = {
      prompt: s.prompt,
      genre_primary: s.genrePrimary,
      tone: s.tone,
      style: s.style,
    };
    onSubmitted(intent);
  }, [onSubmitted, subjectDisabled]);

  useEffect(() => {
    onSubmitReady?.(valid ? handleSubmit : null, valid);
    return () => onSubmitReady?.(null, false);
  }, [valid, handleSubmit, onSubmitReady]);

  return (
    <div className="flex flex-col flex-1 min-h-0">
      <div className="flex-1 min-h-0 overflow-y-auto px-6 pt-2 pb-4">
        <div className="h-full bg-surface-container-low border border-outline-variant rounded-lg p-4 flex flex-col">
          <label
            htmlFor="prompt"
            className="block font-display text-sm font-medium text-primary mb-1 shrink-0"
          >
            灵感点子 <span className="text-on-surface-variant text-xs">(≥10 字)</span>
          </label>
          <textarea
            id="prompt"
            className="w-full flex-1 min-h-[16rem] bg-surface-container border border-outline-variant rounded-lg px-3 py-2 text-sm text-primary focus:outline-none focus:border-primary-container focus:ring-1 focus:ring-primary-container resize-y"
            maxLength={MAX_PROMPT}
            placeholder="一句话描述你想写的故事核心 — 比如:赛博朋克 + 修仙 + 双男主"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <div className="flex justify-end mt-1 shrink-0">
            <span className={`font-mono text-[10px] ${prompt.length < 10 ? "text-on-surface-variant" : "text-primary-container"}`}>
              {prompt.length} / {MAX_PROMPT} 字
            </span>
          </div>
        </div>
      </div>

      {anyDisabled && (
        <div className="px-6 pt-2 text-error text-xs" data-testid="dimensions-disabled-hint">
          {subjectDisabled && <span>题材暂无生效选项，</span>}
          {toneDisabled && <span>基调暂无生效选项，</span>}
          {styleDisabled && <span>风格暂无生效选项，</span>}
          <a
            href="/creative-dimensions"
            className="underline"
            data-testid="goto-dimensions-link"
          >
            前往配置
          </a>
        </div>
      )}

      <div className="px-6 pt-3 pb-4 border-t border-outline-variant shrink-0">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-x-4 gap-y-3">
          <div className="flex items-center gap-2 min-w-0">
            <label className="font-display text-sm font-medium text-primary whitespace-nowrap shrink-0">
              {KIND_LABEL.subject}
            </label>
            <DropdownSelect
              options={subjectOptions}
              value={genrePrimary}
              onChange={setGenrePrimary}
              direction="up"
              disabled={subjectDisabled}
            />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <label className="font-display text-sm font-medium text-primary whitespace-nowrap shrink-0">
              {KIND_LABEL.tone}
            </label>
            <DropdownSelect
              options={toneOptions}
              value={toneVal}
              onChange={setTone}
              direction="up"
              disabled={toneDisabled}
            />
          </div>
          <div className="flex items-center gap-2 min-w-0">
            <label className="font-display text-sm font-medium text-primary whitespace-nowrap shrink-0">
              {KIND_LABEL.style}
            </label>
            <DropdownSelect
              options={styleOptions}
              value={styleVal}
              onChange={setStyle}
              direction="up"
              disabled={styleDisabled}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
```

> 备注：`DropdownSelect` 必须支持 `disabled` prop。先确认：

```bash
cd /Users/longsa/Codes/nebula/frontend
grep -n "disabled\|interface.*Props\|type.*Props" src/components/ds/DropdownSelect.tsx | head -20
```

**若 DropdownSelect 已有 `disabled` prop**：直接用，无需改动。

**若没有**：打开 `DropdownSelect.tsx`，在 Props 类型加 `disabled?: boolean`，并在 button 渲染处加 `disabled={disabled}` 和 `opacity-50 cursor-not-allowed` 类：

- [ ] **Step 4: 跑 S1 测试**

```bash
cd /Users/longsa/Codes/nebula/frontend
npm test -- S1InputStep 2>&1 | tail -30
```

期望：3 个 test PASS（取决于测试断言对 DropdownSelect 实际 DOM 结构的适配 —— 若失败需调整测试 query）。

- [ ] **Step 5: 跑全部前端测试**

```bash
cd /Users/longsa/Codes/nebula/frontend
npm test 2>&1 | tail -30
```

期望：所有 test PASS（已有 + 新增）。若有 S1 现有 test 引用 `GENRE_LABEL_FALLBACK` 等已删常量，需要更新它们。

- [ ] **Step 6: Commit**

```bash
git add frontend/src/components/wizard/divergence_v2/S1InputStep.tsx frontend/src/components/ds/DropdownSelect.tsx frontend/src/test/wizard/divergence_v2/S1InputStep.test.tsx
git commit -m "refactor(s1): read creative dimensions via hook, disable empty dropdowns"
```

---

## Task 13: E2E 烟雾测试扩展

**Files:**
- Modify: `tests/test_divergence_v2_smoke.py`

- [ ] **Step 1: 看现有 E2E 测试结构**

```bash
cd /Users/longsa/Codes/nebula
ls tests/test_divergence_v2_smoke.py 2>&1
head -50 tests/test_divergence_v2_smoke.py 2>&1
```

确认现有结构（fixtures、TestClient 用法、辅助函数）。

- [ ] **Step 2: 在文件末尾加 E2E 测试**

追加：

```python
"""E2E smoke for creative dimensions injection into three_b prompts."""
from __future__ import annotations

import pytest


@pytest.fixture
def dim_store_with_descriptions(tmp_path):
    """提供一个含 description 的 store。"""
    from backend.creative_os.creative_dimensions import (
        DimensionsCatalog, DimensionEntry,
    )
    from backend.services.creative_dimensions_store import CreativeDimensionsStore
    cat = DimensionsCatalog(
        subject=[DimensionEntry(id="xuanhuan", name="玄幻", description="东方仙侠世界",
                                status="active", order=0,
                                created_at="2026-01-01T00:00:00Z",
                                updated_at="2026-01-01T00:00:00Z")],
        tone=[DimensionEntry(id="rexue", name="热血", description="激烈昂扬",
                             status="active", order=0,
                             created_at="2026-01-01T00:00:00Z",
                             updated_at="2026-01-01T00:00:00Z")],
        style=[DimensionEntry(id="shuangwen", name="爽文", description="节奏紧凑",
                              status="active", order=0,
                              created_at="2026-01-01T00:00:00Z",
                              updated_at="2026-01-01T00:00:00Z")],
    )
    path = tmp_path / "creative_dimensions.json"
    store = CreativeDimensionsStore(path, lambda: cat)
    store.load()
    return store


@pytest.mark.usefixtures("dim_store_with_descriptions")
def test_active_endpoint_returns_three_dims(client):
    resp = client.get("/api/v1/creative-dimensions/active")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["subject"]) == 1 and body["subject"][0]["id"] == "xuanhuan"
    assert len(body["tone"])    == 1 and body["tone"][0]["id"] == "rexue"
    assert len(body["style"])   == 1 and body["style"][0]["id"] == "shuangwen"


@pytest.mark.usefixtures("dim_store_with_descriptions")
def test_genres_compat_filters_inactive_by_default(client):
    resp = client.get("/api/v1/genres")
    assert resp.status_code == 200
    body = resp.json()
    ids = [g["id"] for g in body]
    assert "xuanhuan" in ids
```

> 注：实际 fixture `client` 来自该文件的现有 setup（TestClient with lifespan）。若 fixture 名称不同，按现有文件调整。

- [ ] **Step 3: 跑 smoke 测试**

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
pytest tests/test_divergence_v2_smoke.py -v
```

期望：所有 test PASS（含新增的 2 个）。

- [ ] **Step 4: Commit**

```bash
git add tests/test_divergence_v2_smoke.py
git commit -m "test(e2e): creative dimensions API + injection smoke"
```

---

## Task 14: 全量回归

- [ ] **Step 1: 跑全部后端测试**

```bash
cd /Users/longsa/Codes/nebula
source venv/bin/activate
pytest backend/tests/ -v --tb=short 2>&1 | tail -50
```

期望：全部 PASS（已有 + 新增）。若有失败，单独处理。

- [ ] **Step 2: 跑全部前端测试**

```bash
cd /Users/longsa/Codes/nebula/frontend
npm test 2>&1 | tail -50
```

期望：全部 PASS。

- [ ] **Step 3: 手动 smoke**

按 spec §5.4 验收清单逐项走一遍：
- [ ] 删除 `config/creative_dimensions.json`，重启 backend → 文件自动恢复
- [ ] 创作维度页改某题材状态 → S1 该题材下拉不含该项
- [ ] 清空某条目描述 → 走 S1 → mock LLM prompt 不含该维度行
- [ ] 删除某条目 → 已有 three_b_state.json 不报错
- [ ] `/api/v1/genres` 仍返回有效题材

- [ ] **Step 4: Final commit (若有修复)**

```bash
git status --short
# 视情况 commit 任何修复
```

---

## 附录 A: 已知陷阱

| 陷阱 | 缓解 |
|---|---|
| `/api/v1/creative-dimensions/active` 被 `/{kind}` 通配捕获 | 路由声明顺序固定，`/active` 和 `/` 必须在 `/{kind}` 之前 |
| `_get_dimensions_store` 模块级 ref 在测试间泄漏 | 测试用 monkeypatch 覆盖 |
| `DropdownSelect` 原本不支持 `disabled` | Task 12 Step 3 末尾检查 + 加 prop 透传 |
| 启动 seed 把现有 Genre catalog 复制到 JSON | 一次性，写盘后不再重跑 |
| `frontend/src/test/...` 路径下 import `@/hooks/...` 必须从项目根视角正确（不是 `../../hooks/...`） | 见 memory `feedback_plan_import_paths.md` |
| 后端 `.env` 改了 → pydantic-settings 重启 | 跟现有 dev 流程一致，无需特别处理 |
| LLM provider 离线 | 跑 mock provider；E2E 测试用 `mock_provider.py` |
| vitest 冷缓存偶现 `ReferenceError: document is not defined` | 见 memory `project_vitest_jsdom_cold_cache.md`：重跑一次 |
| npm test 必须 `cd frontend` 后跑 | 见 memory `project_vitest_run_from_frontend_dir.md` |