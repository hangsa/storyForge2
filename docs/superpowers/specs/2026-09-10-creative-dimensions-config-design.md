# 创作维度配置（题材 / 基调 / 风格）+ S1 联动 + LLM prompt 注入

> **Status:** Draft for review
> **Author:** Claude (brainstorming with user)
> **Date:** 2026-09-10
> **Scope:** 新增全局「创作维度」配置能力，覆盖原 Genre catalog；改造 `divergence_v2` S1 输入；为 3 个 three_b prompt 注入统一「设定背景」块。

---

## 1. 目标与非目标

### 1.1 目标

1. 提供全局 CRUD 能力，管理三类创作维度的可选标签：
   - **题材（subject）** —— 替换现有 Genre catalog（仙侠、玄幻、都市…）
   - **基调（tone）** —— 替换原 `S1InputStep` 硬编码 `TONE_OPTIONS`（热血、黑暗…）
   - **风格（style）** —— 替换原 `S1InputStep` 硬编码 `STYLE_OPTIONS`（爽文、慢热…）
2. 新维度项数据形态：`(id, name, description, status, family?, label_en?, order, created_at, updated_at)`，description 为 textarea 文本，status 为「生效 / 失效」。
3. 新增侧边栏项「创作维度」→ 新页面 `/creative-dimensions`，左 Tab 三维度切换，右侧 Edit Panel。
4. S1 灵感输入页三个下拉改为只展示对应维度下 `status === "active"` 的标签；某维度无 active 时该下拉禁用并提示。
5. S1 选中后，对应条目的 `description` 在 **decompose / adaptive_diverge / commit** 三个 prompt 的 user message 开头注入统一的「设定背景」块（仅在有 description 的维度上行才出现）。
6. 现有 `GET /api/v1/genres` 路由**保留**为只读兼容入口，从新 store 读取（status='active' 过滤、`ui_visible_only=true`）。

### 1.2 非目标

- 不修改 `RawIntent` 字段（仍是 id 字符串，后端负责查表补描述）
- 不修改 S2/S3/S4 渲染逻辑（除 prompt 注入外）
- 不在 prompt 块内强制 LLM 输出特定字段；只是提供更多上下文
- 不迁移存量 `three_b_state.json` —— 旧 state 中引用的 id 若在 active 列表里找不到，按"无描述"处理（设定背景块不出现该维度那一行）
- 不删除 `backend/genres/catalog.py` 的 YAML 文件 —— 保留为只读 seed 源
- 不做软删除 / 回收站；删除即真删
- 不支持批量导入 / 导出；单条 CRUD

---

## 2. 背景与动机

### 2.1 现状

- `S1InputStep.tsx` 中 `TONE_OPTIONS`（热血 / 黑暗 / 轻松 / 史诗 / 虐心 / 治愈 / 悬疑 / 成长）和 `STYLE_OPTIONS`（爽文 / 慢热 / 群像 / 单线 / 多线 / 倒叙 / 正叙）硬编码
- `useGenres()` hook → `GET /api/v1/genres` 提供题材下拉，读取 `backend/genres/catalog.py` 的 YAML catalog
- 三个维度的 label 在 `three_b_decompose.yaml` 等 prompt 里仅作为单行 `{tone}` / `{style}` 出现，无描述注入
- 现有项目侧栏无「创作维度」类入口；所有维度的配置入口缺失

### 2.2 关键决策记录（来自 brainstorming）

| 决策 | 选择 | 原因 |
|---|---|---|
| 数据归属层级 | **全局库（global-only）** | 跨项目复用、管理集中 |
| S1 选择方式 | **单选** | 避免描述叠加导致 prompt 过长、与现有交互一致 |
| 导航位置 | **同级独立侧边栏项**（不是 Prompt Plaza 内 tab） | 用户选择 |
| 注入方式 | **独立的「设定背景」块**（prompt 开头独立段） | 用户选择 |
| 空库表现 | **空维度对应下拉禁用** | 避免无选项可选 |
| 注入范围 | **decompose + adaptive_diverge + commit** | 用户选择 |
| 与 Genre catalog 关系 | **统一替换为新 store** | 用户选择 |

---

## 3. 设计

### 3.1 数据模型

`backend/creative_os/creative_dimensions.py`：

```python
from dataclasses import dataclass, field
from typing import Literal, Optional

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
```

Pydantic schema（用于 API 验证）：

```python
class DimensionEntryPayload(BaseModel):
    name: str = Field(..., min_length=1, max_length=64)
    description: str = Field(default="", max_length=2000)
    status: EntryStatus = "active"
    family: Optional[str] = Field(default=None, max_length=64)
    label_en: Optional[str] = Field(default=None, max_length=128)
    order: int = Field(default=0, ge=0, le=9999)

    model_config = ConfigDict(extra="forbid")
```

POST 时服务端根据 `name` 生成 `id`（slug 生成规则：用 `pypinyin` 把中文转拼音小写 + ASCII 化；非中文名直接 lowercase；冲突加 `-2`、`-3` 后缀；最多重试 5 次）；PUT 时不允许改 id。

### 3.2 存储

单一 JSON 文件 `config/creative_dimensions.json`：

```json
{
  "subject": [
    {"id": "cool_novel", "name": "爽文", "description": "", "status": "active",
     "family": "xuanhuan", "label_en": "Cool Novel", "order": 0,
     "created_at": "2026-09-10T10:00:00Z", "updated_at": "2026-09-10T10:00:00Z"},
    ...
  ],
  "tone": [...],
  "style": [...]
}
```

存储路径解析：优先 `settings.creative_dimensions_path`（新增配置项），缺省回退到 `Path(settings.projects_dir).parent / "config" / "creative_dimensions.json"`。

原子写：`tempfile.mkstemp` + `os.replace`，与 `three_b_engine.atomic_write_state` 一致。

**Seed 初始化**：
- 启动时（app lifespan 或 store 首次构造）若 JSON 文件不存在 → 从 `backend/genres/catalog.py` 现有 YAML 读取 + 程序硬编码的 tone/style 初始 7/6 项 → 写入 JSON
- 若 JSON 已存在 → 不动
- seed 阶段强制 `description=""` `status="active"`（YAML 无描述字段，不凭空生成）
- seed 是一次性的（仅在文件不存在时触发），后续启动读 JSON

### 3.3 后端 Store

`backend/services/creative_dimensions_store.py`（仿照 `global_prompt_override_store.py` 的模式）：

```python
class CreativeDimensionsStore:
    def __init__(self, store_path: Path, seed_loader: Callable[[], DimensionsCatalog]):
        self._path = store_path
        self._seed_loader = seed_loader

    def load(self) -> DimensionsCatalog:
        if not self._path.exists():
            data = self._seed_loader()
            self._save(data)
            return data
        return DimensionsCatalog(**json.loads(self._path.read_text("utf-8")))

    def list(self, kind: DimensionKind, active_only: bool = False) -> list[DimensionEntry]:
        ...

    def add(self, kind: DimensionKind, payload: DimensionEntryPayload) -> DimensionEntry:
        """生成 id，校验 name 唯一（同 kind 下 name 不重复），落盘后返回。"""

    def update(self, kind: DimensionKind, entry_id: str, payload: DimensionEntryPayload) -> DimensionEntry:
        ...

    def delete(self, kind: DimensionKind, entry_id: str) -> bool:
        ...

    def get(self, kind: DimensionKind, entry_id: str) -> Optional[DimensionEntry]:
        """按 id 查找，供 three_b_engine._build_dimension_block 使用。"""

    def _save(self, catalog: DimensionsCatalog) -> None:
        """atomic write via .tmp + replace."""
```

**单例**：`app.state.creative_dimensions_store` 在 `backend/main.py` lifespan 中创建（同 `three_b_engine` 模式）。FastAPI Depends 注入辅助函数 `_get_store(request)`。

### 3.4 后端路由

新文件 `backend/api/creative_dimensions.py`：

```python
router = APIRouter(prefix="/api/v1/creative-dimensions", tags=["creative_dimensions"])

# ⚠️ 顺序敏感：`/active` 和 `/` 必须在 `/{kind}` 之前注册，否则会被
# 通配捕获（FastAPI 路由匹配按声明顺序）。下面代码块严格保持顺序。

@router.get("/active")
async def list_active(request: Request) -> dict:
    """S1 一次拿齐：{ subject: [...], tone: [...], style: [...] }，全部过滤 status==active。"""

@router.get("")
async def list_all(request: Request) -> dict:
    """管理页用：返回全量（包含 status=='inactive'），shape 同 /active。"""

@router.get("/{kind}")
async def list_by_kind(kind: str, request: Request) -> list[dict]:
    """单维度列表（全量，含 inactive），admin 用。"""

@router.post("/{kind}")
async def add_entry(kind: str, payload: DimensionEntryPayload, request: Request) -> dict:
    """新增。"""

@router.put("/{kind}/{entry_id}")
async def update_entry(kind: str, entry_id: str, payload: DimensionEntryPayload, request: Request) -> dict:
    """更新。"""

@router.delete("/{kind}/{entry_id}")
async def delete_entry(kind: str, entry_id: str, request: Request) -> dict:
    """删除。"""
```

`{kind}` 路径校验：`kind in {"subject", "tone", "style"}`，否则 400。

**错误码**：所有路由失败用标准 envelope `{"error": True, "code": "...", "message": "..."}`，与 `prompt_plaza.py` 一致。

### 3.5 兼容现有 `/api/v1/genres`

`backend/api/genres.py` 改造：

```python
@router.get("")
async def list_genres(ui_visible_only: bool = True) -> list[dict]:
    """Return [{id, label_zh, label_en, family, ui_visible}, ...].

    现在读 CreativeDimensionsStore 的 subject 维度。`ui_visible_only=true`
    等价于 status=='active' 过滤。字段映射：
      id ↔ id, label_zh ↔ name, label_en ↔ label_en, family ↔ family,
      ui_visible ↔ (status == 'active')
    """
```

`backend/genres/catalog.py` 保留作为 seed loader：

```python
def load_seed() -> DimensionsCatalog:
    """从硬编码 + YAML 拼出初始 DimensionsCatalog，供 store 启动时使用。"""
```

现有 consumers（项目创建、概念生成）**无需改任何调用代码**，因为 `list_genres` 接口签名和返回结构保持兼容。

### 3.6 S1 改造

`frontend/src/components/wizard/divergence_v2/S1InputStep.tsx`：

**移除**：
- `TONE_OPTIONS`、`STYLE_OPTIONS` 常量
- `GENRE_LABEL_FALLBACK`（不再需要，store 自带 label）

**新增**：
- `useCreativeDimensions()` hook（见 §3.7）

**逻辑改造**：

```tsx
const { subject, tone, style, loading, error } = useCreativeDimensions();

const subjectOptions = useMemo(
  () => subject.map((e) => ({ value: e.id, label: e.name })),
  [subject],
);
const toneOptions    = useMemo(() => tone.map(...), [tone]);
const styleOptions   = useMemo(() => style.map(...), [style]);

// 默认值：
//   subject = subject[0]?.id ?? DEFAULT_GENRE_FALLBACK  (DEFAULT_GENRE_FALLBACK = "cool_novel"，仅在 subject 列表完全为空时兜底；此时整个 S1 仍可点提交但 prompt 不含题材描述)
//   tone    = tone[0]?.value ?? "" (空字符串在该维度禁用时也存在，仅本地展示用)
//   style   = style[0]?.value ?? "" (同上)

const subjectDisabled = subjectOptions.length === 0;
const toneDisabled    = toneOptions.length === 0;
const styleDisabled   = styleOptions.length === 0;

// valid 条件：prompt.length >= 10 && !subjectDisabled && subjectPrimary 选中
```

**下拉禁用行为**：
- `<DropdownSelect disabled={subjectDisabled} />`
- 下方加一行红色小字 + 「前往配置」链接（`onClick={() => window.location.assign('/creative-dimensions')}`）当任一被禁用时显示

**新增的 RawIntent 提交**：不变（仍是 id 字符串），后端负责补描述。

**stale 值处理**：用户曾在 S1 选了 `tone="热血"`，后续该条目被 admin 失效或删除。S1 重 mount 时若 `initial.tone` 引用已不在 active 列表 → 静默回退到 `tone[0]?.value ?? ""`（即列表首项或空串），不报错。`initial.genre_primary` 同理。

### 3.7 前端 hook

`frontend/src/hooks/useCreativeDimensions.ts`：

```ts
import { useCallback, useEffect, useState } from "react";
import api from "../api/client";
import type { DimensionEntry } from "../api/types";

type ActiveDimensions = {
  subject: DimensionEntry[];
  tone: DimensionEntry[];
  style: DimensionEntry[];
};

let cache: ActiveDimensions | null = null;
let inflight: Promise<ActiveDimensions> | null = null;

export function useCreativeDimensions(activeOnly = true) {
  const [data, setData] = useState<ActiveDimensions>(cache ?? { subject: [], tone: [], style: [] });
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cache) { setData(cache); return; }
    if (!inflight) {
      inflight = api.listActiveCreativeDimensions().then((d) => { cache = d; return d; });
    }
    inflight.then(setData).catch((e) => setError(e.message)).finally(() => {
      setLoading(false);
      inflight = null;
    });
  }, []);

  const refresh = useCallback(async () => {
    cache = null;
    inflight = api.listActiveCreativeDimensions().then((d) => { cache = d; return d; });
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
```

### 3.8 前端 API client 扩展

`frontend/src/api/client.ts` 新增：

```ts
listActiveCreativeDimensions(): Promise<{ subject: DimensionEntry[]; tone: DimensionEntry[]; style: DimensionEntry[] }>
listCreativeDimensions(kind: "subject" | "tone" | "style"): Promise<DimensionEntry[]>
addCreativeDimension(kind: ..., payload: DimensionEntryPayload): Promise<DimensionEntry>
updateCreativeDimension(kind: ..., id: string, payload: DimensionEntryPayload): Promise<DimensionEntry>
deleteCreativeDimension(kind: ..., id: string): Promise<void>
```

新类型文件 `frontend/src/api/types.ts`（或合并入 client.ts）：

```ts
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
```

### 3.9 LLM prompt 注入

`backend/creative_os/three_b_engine.py` 新增模块级 helper：

```python
def _build_dimension_block(raw_intent: Optional[RawIntent]) -> str:
    """从 store 读取三个维度的条目，按 raw_intent 选中的 id 拼出描述行。"""
    if raw_intent is None:
        return ""
    store = _get_dimensions_store()  # 通过 app.state 或模块单例
    lines: list[str] = []
    for kind, label, value in [
        ("subject", "题材", raw_intent.genre_primary),
        ("tone",    "基调", raw_intent.tone),
        ("style",   "风格", raw_intent.style),
    ]:
        if not value:
            continue
        entry = store.get(kind, value)
        if entry and entry.description.strip():
            lines.append(f"{label}（{entry.name}）：{entry.description.strip()}")
    return "\n".join(lines)
```

调用点（统一策略：三个 prompt 都通过 `_maybe_inject_block` 在已有 `format()` 之后做字符串前置拼接；YAML 模板本身不需任何占位符）：

| 方法 | 现有调用 | 改造 |
|---|---|---|
| `decompose()` | `_invoke_llm_json(DECOMPOSE_PROMPT, ..., user_modifications=...)` | 把 `format(...)` 输出传给 `_maybe_inject_block` 再发 LLM |
| `_diverge_single_unit()` | `_invoke_llm_json(ADAPTIVE_DIVERGE_PROMPT, ...)` | 同上 |
| `commit()` | `_build_commit_user_prompt(...)` | 把 `_build_commit_user_prompt(...)` 输出传给 `_maybe_inject_block` 再发 LLM |

**Prompt YAML 改造**（3 个文件）：

`three_b_decompose.yaml`、`three_b_adaptive_diverge.yaml`、`three_b_commit.yaml` 的 `user_prompt_template` **不变**。注入由后端在调用 `_invoke_llm_json` 前对 `user_prompt_template.format(...)` 的输出再做一次字符串前缀拼接：

```python
def _maybe_inject_block(rendered_user_prompt: str, raw_intent: Optional[RawIntent]) -> str:
    block = _build_dimension_block(raw_intent)
    if not block:
        return rendered_user_prompt
    return "【设定背景】\n" + block + "\n\n" + rendered_user_prompt
```

即三个 YAML 都不加任何占位符，由 `_maybe_inject_block` 在已有 format 之后前置拼接（避免占位符残留空字符串污染 prompt）。

### 3.10 前端页面

`frontend/src/pages/CreativeDimensionsPage.tsx`：

```tsx
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

`frontend/src/components/creativeDimensions/CreativeDimensionsView.tsx`：

布局：顶部 header（标题「创作维度」+ 关闭按钮）+ 主体双栏。

**左栏**：三维度 Tab（subject / tone / style）。点击切换 active kind。每个 Tab 显示条目数 badge（格式 "5/12"，5 = active 计数，12 = total）。

**右栏**：
- 顶部操作条：「+ 新增」按钮（打开空 form panel）+ 「搜索」输入框（按 name / description 过滤）
- 中部条目列表：每行显示 name + status（圆点颜色：active=绿，inactive=灰）+ 描述预览（截前 50 字）
- 点击某行 → Edit Panel 覆盖在列表上方（半透明遮罩 + 居中卡片，与现有编辑对话框模式一致）：
  - 名称 input
  - 状态 segmented control（生效 / 失效）
  - 描述 textarea（带字数计数）
  - 排序 input（数字）
  - 主题专属：family input、label_en input（仅 subject 显示）
  - 底部：[保存] [删除] [取消]
- 删除二次确认：复用项目内 `ConfirmNextDialog` 组件（与现有 S4 删除前的确认交互一致）

**复用设计系统**：
- `PanelCard` 包裹 Edit Panel
- `PrimaryButton` / `GhostButton` / `SecondaryButton`
- `SearchInput`
- `DropdownSelect` 用作状态切换（替代 segmented control，避免新增组件）
- 列表行使用现成的 `<tr>` 模式（参考 BookShelf 表格）

### 3.11 侧边栏

`frontend/src/components/home/StatsSidebar.tsx` 在「提示词广场」下方加：

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

`isBookshelfActive` 等旁加 `const isDimensionsActive = location.pathname === "/creative-dimensions"`。

路由注册：`frontend/src/App.tsx` 加 `<Route path="/creative-dimensions" element={<CreativeDimensionsPage />} />`。

---

## 4. 错误处理与边界

| 场景 | 处理 |
|---|---|
| 启动时 JSON 不存在 | seed loader 自动初始化；不报错 |
| 启动时 JSON 损坏 | store 捕获 `json.JSONDecodeError`，重命名为 `.bak`，重新走 seed 初始化，记录 warning |
| POST 时同 kind 下 name 重复 | 返回 400 `{"code": "DUPLICATE_NAME", "message": "..."}` |
| POST 时 id 冲突（极小概率，自动生成碰撞） | 服务端加数字后缀重试，最多重试 3 次，仍冲突 → 500 |
| PUT 时 entry_id 不存在 | 404 `{"code": "NOT_FOUND"}` |
| DELETE 时 entry_id 不存在 | 404 |
| `{kind}` 非枚举 | 400 `{"code": "INVALID_KIND"}` |
| S1 选中 id 在 active 列表里找不到 | S1 mount 时静默 fallback 到对应维度列表首项；three_b_engine `_build_dimension_block` 取不到 entry → 该行不出现，prompt 注入降级 |
| three_b_state.json 中引用已被失效 / 删除的 id | 同上，decompose 时该行不出现 |
| 描述过长（> 2000 字） | POST/PUT 校验 400 |
| 描述含 SF_LOG 注入尝试 | 后端 description 不参与 LLM 拼接以外的任何路径解析；前端展示做 `escape()`，无 XSS 面 |
| 前端缓存与后端不同步 | `useCreativeDimensions` 在新页面 mount 时强制 `refresh()`；S1 mount 时若 cache 存在则沿用（不阻塞首屏） |
| 并发写 | atomic .tmp + replace 保证一致性；无锁 |

---

## 5. 测试覆盖

### 5.1 后端单元测试

| 文件 | 用例 |
|---|---|
| `tests/test_services/test_creative_dimensions_store.py` | CRUD 全覆盖；并发写原子性；JSON 损坏 → 自动 seed；id 生成 + 重复 name 校验 |
| `tests/test_api/test_creative_dimensions_routes.py` | 6 个路由 200/4xx 路径；kind 枚举校验；payload extra='forbid' |
| `tests/test_api/test_genres_compat.py` | `/api/v1/genres` 从新 store 读，`ui_visible_only=true` 过滤 status=='active'，字段映射正确 |
| `tests/test_creative_os/test_three_b_engine.py`（扩展） | `_build_dimension_block`：三维度全有 description / 部分有 / 全无 / 引用失效 id |
| `tests/test_creative_os/test_three_b_prompt_injection.py`（新增） | 三个 prompt 模板 format 时正确包含「设定背景」块；空 block 时整段不出现 |

### 5.2 前端测试

| 文件 | 用例 |
|---|---|
| `frontend/src/test/hooks/useCreativeDimensions.test.ts` | 缓存命中 / 未命中 / 错误处理 |
| `frontend/src/test/wizard/divergence_v2/S1InputStep.test.tsx` | (a) 三维均有 active → 全部可选；(b) 某维度空 → 该下拉禁用 + 提示出现；(c) 默认值 fallback；(d) 提交 RawIntent shape 不变 |
| `frontend/src/test/pages/CreativeDimensionsPage.test.tsx` | 维度切换、新增、编辑、删除二次确认 |

### 5.3 E2E 烟雾测试（必跑）

扩展 `tests/test_divergence_v2_smoke.py`：

1. 启动 backend，前端 dev server
2. POST `/api/v1/creative-dimensions/subject` 新增一条含 description 的题材条目；POST tone / style 各一条
3. GET `/api/v1/creative-dimensions/active` → 三条均存在
4. 走 divergence_v2：S1 选择刚加的三个 id → POST `/three-b/decompose`
5. 检查 mock LLM provider 收到的 user prompt 包含 `【设定背景】\n题材（X）：...\n基调（Y）：...\n风格（Z）：...\n\n...` 头部
6. 同理测 `/diverge` 和 `/commit` 三个路由都包含设定背景块

### 5.4 手动验收清单

- [ ] 删除 `config/creative_dimensions.json`，重启 backend → 文件自动恢复含原 Genre catalog 内容
- [ ] 在「创作维度」页把某题材状态改为失效 → S1 该题材下拉不含该项
- [ ] 把某题材描述清空 → 走 S1 → mock LLM prompt 不含该维度的「设定背景」行
- [ ] 删除某条目 → 已存在的 `three_b_state.json` 不报错（decompose 时该行不出现）
- [ ] 现有 `GET /api/v1/genres` 仍返回有效题材列表（项目创建流程不受影响）

---

## 6. 受影响的文件清单

| 文件 | 类型 | 改动 |
|---|---|---|
| `backend/creative_os/creative_dimensions.py` | 新建 | 数据模型 dataclass |
| `backend/services/creative_dimensions_store.py` | 新建 | Store 单例 + seed loader + CRUD |
| `backend/api/creative_dimensions.py` | 新建 | 6 个路由 |
| `backend/main.py` | 修改 | lifespan 创建 store；注册新 router |
| `backend/config.py` | 修改 | 加 `creative_dimensions_path` 设置 |
| `backend/genres/catalog.py` | 修改 | 加 `load_seed()` 函数（不改现有 list 行为） |
| `backend/api/genres.py` | 修改 | `list_genres` 改读新 store |
| `backend/creative_os/three_b_engine.py` | 修改 | 新增 `_build_dimension_block` + `_maybe_inject_block`；3 处调用点改造 |
| `backend/prompts/creative/three_b_decompose.yaml` | 不改 | YAML 模板不变；注入由后端 `_maybe_inject_block` 在 format 之后字符串前置拼接 |
| `backend/prompts/creative/three_b_adaptive_diverge.yaml` | 不改 | 同上 |
| `backend/prompts/creative/three_b_commit.yaml` | 不改 | 同上 |
| `frontend/src/api/client.ts` | 修改 | 加 5 个新方法 + 1 个类型 import |
| `frontend/src/api/types.ts` | 新建 | `DimensionEntry` 类型（或扩 `client.ts`） |
| `frontend/src/hooks/useCreativeDimensions.ts` | 新建 | hook |
| `frontend/src/components/wizard/divergence_v2/S1InputStep.tsx` | 修改 | 替换硬编码 → 用 hook；下拉禁用逻辑 |
| `frontend/src/components/creativeDimensions/CreativeDimensionsView.tsx` | 新建 | 双栏主区 |
| `frontend/src/components/creativeDimensions/EntryEditPanel.tsx` | 新建 | 右侧编辑面板 |
| `frontend/src/components/creativeDimensions/DimensionTabs.tsx` | 新建 | 左 Tab |
| `frontend/src/pages/CreativeDimensionsPage.tsx` | 新建 | 页面壳 |
| `frontend/src/components/home/StatsSidebar.tsx` | 修改 | 加 `nav-creative-dimensions` 项 |
| `frontend/src/App.tsx` | 修改 | 加 `/creative-dimensions` 路由 |
| `tests/test_services/test_creative_dimensions_store.py` | 新建 | 单元测试 |
| `tests/test_api/test_creative_dimensions_routes.py` | 新建 | 路由测试 |
| `tests/test_api/test_genres_compat.py` | 新建 | 兼容测试 |
| `tests/test_creative_os/test_three_b_engine.py` | 修改 | 加 `_build_dimension_block` 用例 |
| `tests/test_creative_os/test_three_b_prompt_injection.py` | 新建 | 3 个 prompt 模板 format 测试 |
| `frontend/src/test/hooks/useCreativeDimensions.test.ts` | 新建 | hook 测试 |
| `frontend/src/test/wizard/divergence_v2/S1InputStep.test.tsx` | 修改 | 扩展覆盖新场景 |
| `frontend/src/test/pages/CreativeDimensionsPage.test.tsx` | 新建 | 页面测试 |
| `tests/test_divergence_v2_smoke.py` | 修改 | E2E 烟雾测试增量 |

---

## 7. 不在范围内（follow-up）

- 批量 CSV 导入导出
- 多语言（i18n）支持（当前 `name` / `description` 仅中文）
- 描述里嵌入可点击链接 / 富文本
- 软删除 / 回收站
- 「灵感输入页」之外的维度联动（例如基调用到 world building）
- 把 `family` 字段做成可配置（目前仅 subject 引用，仍读原 catalog 值）
- 三维度共用一个 `Description` 字段类型 schema 验证（目前是 `max_length=2000` 的纯字符串）

---

## 8. 决策日志（来自 brainstorming session 2026-09-10）

| # | 问题 | 答案 |
|---|---|---|
| 1 | 数据范围 | 全局库 |
| 2 | 多选支持 | 维持单选 |
| 3 | 导航位置 | 同级独立侧边栏项 |
| 4 | 注入方式 | 独立的「设定背景」块 |
| 5 | 空库表现 | 该维度下拉禁用 |
| 6 | 注入范围 | decompose + adaptive_diverge + commit |
| 7 | 与 Genre catalog 关系 | 整个系统统一为新 Tab（兼容路由保留） |
| 8 | 实现路径 | 方案 B（完全替换） |