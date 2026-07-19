# 提示词广场（Prompt Plaza）配置模块设计

> **For agentic workers:** 把 storyForge2 当前 `QuickActions` 里的「提示词广场」占位按钮做成真实可用的 UI，覆盖 24 个 YAML 提示词的浏览与项目级覆盖编辑。

**Branch:** v1.9
**Parent doc:** 无（独立新功能）
**参考实现:** `/Users/longsa/Codes/plotPilot` 的 `frontend/src/components/workbench/PromptPlaza.vue` + 后端 `infrastructure/ai/prompt_packages/`（仅借鉴数据流形态，不复用代码）

---

## 一、目标与非目标

### 目标
1. 在首页侧栏启用「提示词广场」按钮，弹出全屏 modal
2. 展示全部 24 个 YAML 提示词（按功能分组），允许在线编辑项目级覆盖
3. 把项目级覆盖写到 `projects/{project_id}/prompt_overrides.json`
4. `BaseAgent.load_prompt(name, project_id?)` 向后兼容地支持 override 合并（不传 project_id 时行为零变化）

### 非目标
- 不接入 agent 调用点的 `project_id`（让覆盖真正影响写作）— 留给后续 plan
- 不做版本历史 / 回滚 / diff — 用户已选「覆盖当前」
- 不做跨项目模板共享 / 导入导出
- 不做 sandbox dry-run / 变量校验 UI
- 不在工作台加入口（仅首页侧栏一个）

---

## 二、架构

```
┌─────────────────────────────────────────────────────────────────────┐
│                          Frontend (React)                            │
│                                                                       │
│  QuickActions.tsx ──onClick──▶ <PromptPlazaModal>                   │
│                                  │                                    │
│                                  ├─ PromptListPanel    (左, 分类树)   │
│                                  └─ PromptEditPanel    (右, 编辑器)   │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
                                  │  GET/PUT /api/projects/{id}/prompts/...
                                  ▼
┌─────────────────────────────────────────────────────────────────────┐
│                          Backend (FastAPI)                           │
│                                                                       │
│  api/prompt_plaza.py ──路由─────────────────────────────────────┐    │
│       │ GET  /list                                            │    │
│       │ GET  /{name}                                         │    │
│       │ PUT  /{name}                                         │    │
│       │ DELETE /{name}                                       │    │
│       │                                                       ▼    │
│       ▼                                                            │
│  services/prompt_override_store.py                                  │
│       ├─ list_available(project_id)                                │
│       ├─ get_effective(project_id, name)                           │
│       ├─ get_override_only(project_id, name)                       │
│       ├─ set_override(project_id, name, payload)                   │
│       └─ delete_override(project_id, name)                         │
│       │                                                            │
│       │ 合并时读                                                  │
│       ▼                                                            │
│  backend/prompts/{name}.yaml  (YAML 仍是出厂默认值，只读)          │
│                                                                       │
│  agents/base_agent.py                                               │
│       load_prompt(name)  ← 保持不变（向后兼容）                      │
│       load_prompt(name, project_id)  ← 新签名，可选 project_id       │
│       ↳ 内部走 PromptOverrideStore.get_effective(...)               │
│                                                                       │
└─────────────────────────────────────────────────────────────────────┘
```

**关键决策：**
- YAML 是只读出厂值，**永远不写**
- 加载顺序：项目 JSON override → 默认 YAML → `PromptTemplate`
- 不引入 DB / ORM / 缓存层；JSON 文件本身就是真相源
- `BaseAgent.load_prompt` 新增可选 `project_id` 参数；不传则走默认（向后兼容所有现有调用）

---

## 三、数据模型

### 3.1 Override 文件格式

`projects/{project_id}/prompt_overrides.json`：

```json
{
  "scene_writing": {
    "system_prompt": "你是一位……",
    "user_prompt_template": "【故事背景】\n- 类型：{genre}\n……",
    "model": "deepseek-chat",
    "temperature": 0.85,
    "max_tokens": 8192,
    "output_format": {"type": "json"},
    "_modified_at": "2026-07-19T12:34:56Z"
  },
  "outline_generation": { ... }
}
```

要点：
- **键 = 模板名**（与 YAML 文件名一致，不带 `.yaml`）
- **值只存「被改过的字段」** — 字段值等于 YAML 默认值时**不写入**；未提供的字段视为「不动现有 override」
- **`_modified_at`** 是元数据，方便列表展示「最近修改时间」；外部不可写
- 用 `FileManager.write_json` 原子写（先写 .tmp 再 rename），沿用现有约定

### 3.2 PromptTemplate 合并规则

```python
def merge(name, project_id):
    base = load_yaml(name)                              # 出厂值
    override = read_overrides(project_id).get(name)
    if override is None:
        return base
    merged = {
        **base,
        **{k: v for k, v in override.items() if not k.startswith("_")},
    }
    return merged
```

未传入 `project_id` 时退化为原行为 — 完全向后兼容。

### 3.3 Pydantic 模型

`PromptOverridePayload`：

```python
class PromptOverridePayload(BaseModel):
    system_prompt: str | None = None
    user_prompt_template: str | None = None
    model: str | None = None
    temperature: float | None = Field(None, ge=0.0, le=2.0)
    max_tokens: int | None = Field(None, ge=1, le=32768)
    output_format: dict | None = None

    model_config = ConfigDict(extra='forbid')
```

`extra='forbid'` 防止注入 `_modified_at` 等元数据字段。

### 3.4 前端类型

`frontend/src/api/promptPlaza.ts`：

```typescript
interface PromptSummary {
  name: string
  category: string                  // 子目录名（如 "creative"）或 "" 表示根目录
  label: string                     // 中文显示标签（来自 PROMPT_LABEL_OVERRIDES，fallback 到 name）
  has_override: boolean
  modified_at: string | null
  builtin: boolean
}

interface PromptDetail {
  name: string
  builtin_yaml: Record<string, unknown>
  override: Record<string, unknown> | null
  effective: Record<string, unknown>
}
```

---

## 四、API 设计

所有路径前缀 `/api/projects/{project_id}/prompts`：

| 方法 | 路径 | 用途 | 响应 |
|---|---|---|---|
| GET | `/list` | 列出所有可编辑提示词 + override 标记 | `{prompts: PromptSummary[]}` |
| GET | `/{name}` | 读单个提示词的合并视图 | `PromptDetail` |
| PUT | `/{name}` | 写入 override（合并到现有 override） | `{name, override, modified_at}` |
| DELETE | `/{name}` | 删除 override（重置为默认） | `{name, status: "reset"}` |

### 4.1 GET /list 响应示例

```json
{
  "prompts": [
    {
      "name": "scene_writing",
      "category": "",
      "label": "场景写作",
      "has_override": true,
      "modified_at": "2026-07-19T12:34:56Z",
      "builtin": true
    },
    {
      "name": "outline_generation",
      "category": "",
      "label": "大纲生成",
      "has_override": false,
      "modified_at": null,
      "builtin": true
    },
    {
      "name": "creative_director_mutation",
      "category": "creative",
      "label": "创意·创意总监·变异",
      "has_override": false,
      "modified_at": null,
      "builtin": true
    }
  ]
}
```

### 4.2 GET /{name} 响应示例

```json
{
  "name": "scene_writing",
  "builtin_yaml": {
    "name": "scene_writing",
    "provider": "deepseek",
    "model": "deepseek-chat",
    "temperature": 0.9,
    "max_tokens": 8192,
    "system_prompt": "...",
    "user_prompt_template": "..."
  },
  "override": {
    "temperature": 0.85,
    "_modified_at": "2026-07-19T12:34:56Z"
  },
  "effective": {
    "name": "scene_writing",
    "provider": "deepseek",
    "model": "deepseek-chat",
    "temperature": 0.85,
    "max_tokens": 8192,
    "system_prompt": "...",
    "user_prompt_template": "..."
  }
}
```

### 4.3 PUT /{name} 请求示例

```json
{
  "system_prompt": "你是一位擅长节奏紧凑场景的作家……",
  "temperature": 0.85
}
```

### 4.4 错误响应

沿用 `settings_api.py` 的 `{error, code, message, detail}` 风格：

```python
raise HTTPException(status_code=400, detail={
    "error": True, "code": "VALIDATION_ERROR",
    "message": "temperature 必须在 [0.0, 2.0] 范围内",
    "detail": {"field": "temperature", "value": 3.0},
})
```

错误码：
- 404：`name` 对应 YAML 不存在
- 400：Pydantic 校验失败（含具体字段错误）
- 500：JSON 写失败

### 4.5 不做并发控制

单写者假设 — 用户在同一项目内同时打开两个 plaza tab 并编辑同一提示词的可能性极低；冲突最坏结果 = 后写覆盖前写，不损坏数据。如果未来需要，可加 ETag / version 字段。

---

## 五、UI 布局

### 5.1 入口

`QuickActions.tsx` 把 `qa-prompt-square` 从 disabled 改为可点击；点击触发 `usePromptPlaza.open(projectId)`，渲染全屏 modal。

Modal 用 query param `?plaza=open` 标识打开状态 — 支持深链接分享。

### 5.2 Modal 内部布局

```
┌──────────────────────────────────────────────────────────────┐
│ 提示词广场                                  项目：诡眼少年  × │
├────────────────┬─────────────────────────────────────────────┤
│ [搜索]         │  scene_writing                              │
│                │  ┌─ 已自定义 (2026-07-19) ─ 重置为默认 ─┐   │
│ ▸ 写作 (3)     │  └──────────────────────────────────────┘   │
│   • scene_wri..│                                              │
│   • chapter_.. │  System Prompt                              │
│   • outline_.. │  ┌──────────────────────────────────────┐   │
│                │  │ 你是一位资深的网络小说作家…           │   │
│ ▸ 创意 (9)     │  │ (大文本框，自适应高度，约 20 行)      │   │
│   • mutation.. │  └──────────────────────────────────────┘   │
│   • whatif_..  │                                              │
│   • …          │  User Prompt Template                       │
│                │  ┌──────────────────────────────────────┐   │
│ ▸ 大纲 (2)     │  │ 【故事背景】                          │   │
│ ▸ 角色 (1)     │  │ - 类型：{genre}                       │   │
│ ▸ 风格 (1)     │  │ … (约 30 行)                          │   │
│ ▸ 诊断 (2)     │  └──────────────────────────────────────┘   │
│ ▸ 导出 (0)     │                                              │
│ ▸ 其它 (6)     │  ▾ 高级（model / temperature / max_tokens / │
│                │           output_format）                    │
│                │  [重置为默认]              [取消]  [保存]    │
└────────────────┴─────────────────────────────────────────────┘
```

### 5.3 组件层级

```
PromptPlazaModal               (全屏 modal，含遮罩 + ESC 关闭)
├── ModalHeader                (标题 + 项目名 + 关闭)
├── PromptListPanel            (左)
│   ├── SearchInput            (按 name 过滤)
│   └── CategoryGroup[]        (按 category 分组，折叠)
│       └── PromptRow[]        (单行：name + label + has_override 小圆点)
└── PromptEditPanel            (右)
    ├── EditHeader             (name + 已自定义徽章 + 重置按钮)
    ├── EditTextarea
    │   ├── SystemPromptField  (useAutoHeight)
    │   └── UserTemplateField  (useAutoHeight, 字数计)
    ├── AdvancedSection        (折叠：model input / temperature slider / max_tokens input / output_format JSON textarea)
    └── EditFooter             (取消 + 保存)
```

### 5.4 状态管理

新增 `usePromptPlaza(projectId)` hook（`frontend/src/hooks/usePromptPlaza.ts`）：

```typescript
function usePromptPlaza(projectId: string | null) {
  const { data: list, loading, error, refresh: refreshList } = useApi(
    () => api.listPlazaPrompts(projectId!), [projectId]
  )
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const { data: detail, loading: detailLoading, refresh: refreshDetail } = useApi(
    () => selectedName ? api.getPlazaPrompt(projectId!, selectedName) : null,
    [projectId, selectedName]
  )
  const [draft, setDraft] = useState<PromptDetail | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  const isDirty = useMemo(
    () => /* draft vs detail.effective 字段逐项比较 */,
    [draft, detail]
  )

  useBeforeUnload(isDirty)  // 浏览器刷新守卫

  async function save() { /* PUT → 成功 → refreshList + refreshDetail + setDraft */ }
  async function reset() { /* DELETE → refreshList + refreshDetail + setDraft */ }

  return { list, detail, draft, setDraft, isDirty, save, reset, selectedName, setSelectedName, ... }
}
```

### 5.5 Dirty 检测算法

对每个可编辑字段（`system_prompt` / `user_prompt_template` / `model` / `temperature` / `max_tokens` / `output_format`）：
- 比较 `draft[name] === effective[name]`
- 任一字段不同则为 dirty

如果 override 不存在但 draft 改了字段 → 视为 dirty（保存后会产生 override）。

### 5.6 关闭守卫

- ESC 关闭：dirty 时弹原生 `confirm("有未保存修改，确定关闭？")`
- 浏览器刷新 / 关闭 tab：`beforeunload` 事件拦截

### 5.7 键盘

- ESC：关闭（dirty 时 confirm）
- Cmd/Ctrl+S：保存（仅 detail 加载完成后可用，saving 中禁用）

---

## 六、后端实现细节

### 6.1 PromptOverrideStore API

`backend/services/prompt_override_store.py`：

```python
class PromptOverrideStore:
    def __init__(self, projects_dir: Path): ...
    
    def list_available(self, project_id: str) -> list[PromptSummary]:
        """扫描 backend/prompts/ 所有 .yaml（含子目录），标记当前项目有 override 的。"""
        
    def get_effective(self, project_id: str, name: str) -> dict:
        """合并 YAML 默认值 + override，返回完整 dict。"""
        
    def get_override_only(self, project_id: str, name: str) -> dict | None:
        """仅返回 override 字典（如果存在），用于 GET /{name} 的 'override' 字段。"""
        
    def set_override(self, project_id: str, name: str, payload: PromptOverridePayload) -> dict:
        """合并 payload 到现有 override，写回 JSON（原子写），返回新的 override 字典。"""
        
    def delete_override(self, project_id: str, name: str) -> None:
        """从 JSON 中移除该 name 的条目。如果 JSON 变空则删除整个文件。"""
```

### 6.2 字段去重逻辑（set_override 内）

```python
def _prune_to_changed_fields(self, full_override: dict, name: str) -> dict:
    """保留字段值 != YAML 默认值的字段，让 JSON 干净。"""
    base = self._load_yaml(name)
    pruned = {}
    for k, v in full_override.items():
        if k.startswith("_"):
            continue  # 元数据保留
        if base.get(k) != v:
            pruned[k] = v
    # 元数据追加
    pruned["_modified_at"] = datetime.utcnow().isoformat() + "Z"
    return pruned
```

这样用户「改完又改回默认」时 JSON 自动清掉，存储干净。

### 6.3 分类映射

子目录名 → 中文 category label 的映射存在 store 内常量：

```python
PROMPT_CATEGORIES = {
    "creative": "创意",
    "character_designer": "角色",
    "style_engine": "风格",
    "": "其它",  # 根目录
}

PROMPT_LABEL_OVERRIDES = {
    "scene_writing": "场景写作",
    "outline_generation": "大纲生成",
    # ... 可选的中文标签覆盖
}
```

如果某 prompt 没有 `PROMPT_LABEL_OVERRIDES` 条目，前端 fallback 显示 `name` 本身。

### 6.4 BaseAgent.load_prompt 新签名

`backend/agents/base_agent.py`：

```python
def load_prompt(self, template_name: str, project_id: str | None = None) -> PromptTemplate:
    """向后兼容：project_id 为 None 时行为不变。
    
    提供 project_id 时，先查 PromptOverrideStore 合并，再走原 YAML 路径。
    """
    if project_id is None:
        return self._load_prompt_from_yaml(template_name)  # 原行为
    
    merged = self._override_store.get_effective(project_id, template_name)
    return PromptTemplate(merged)

def _load_prompt_from_yaml(self, template_name: str) -> PromptTemplate:
    path = self.prompts_dir / f"{template_name}.yaml"
    if not path.exists():
        raise FileNotFoundError(f"Prompt template not found: {path}")
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    if data is None:
        raise ValueError(f"Empty prompt template: {path}")
    return PromptTemplate(data)
```

### 6.5 Store 注入方式

`BaseAgent.__init__` 新增可选参数 `_override_store`：

```python
def __init__(
    self,
    project_id: str,
    prompts_dir: Optional[Path] = None,
    model_router: Optional[ModelRouter] = None,
    override_store: Optional[PromptOverrideStore] = None,
):
    ...
    self._override_store = override_store
```

- 不传 → `_override_store = None` → `load_prompt(name)` 走原路径（**所有现有调用点不变**）
- 未来接入时由创建 agent 的上层注入 store

### 6.6 路由注册

`backend/main.py` 新增：

```python
from backend.api import prompt_plaza
app.include_router(prompt_plaza.router)
```

Router prefix：`/api/projects/{project_id}/prompts`

### 6.7 API 错误格式

沿用 `settings_api.py` 的 `{error, code, message, detail}` 风格。

---

## 七、测试策略

### 7.1 后端测试

| 文件 | 覆盖 |
|---|---|
| `tests/test_prompt_override_store.py` | store 5 个方法：list_available / get_effective / get_override_only / set_override / delete_override；含合并规则、字段去重、Pydantic 校验、JSON 不存在时返回空 |
| `tests/test_prompt_plaza_api.py` | 4 个 API 端点：404 (name not found)、400 (validation 含具体字段错误)、200 happy path、DELETE 重置后 GET 显示 builtin |
| `tests/test_load_prompt_with_override.py` | `BaseAgent.load_prompt(name, project_id)` 三种场景：无 override（走默认）、部分 override（合并）、全字段 override（替换）；向后兼容（不传 project_id 时与原行为完全一致） |

测试纪律：用真实临时目录 + 真实 YAML fixture，不 mock FileManager；用 `tmp_path` fixture 隔离每个测试。

### 7.2 前端测试

| 文件 | 覆盖 |
|---|---|
| `src/test/promptPlaza/PromptPlazaModal.test.tsx` | modal 打开/关闭、列表加载、选中切换、dirty 检测、ESC 拦截、关闭守卫 |
| `src/test/promptPlaza/PromptEditPanel.test.tsx` | 编辑两个文本框、改温度滑块、折叠高级、保存成功/失败、点重置 |
| `src/test/promptPlaza/PromptListPanel.test.tsx` | 分类折叠、搜索过滤、`has_override` 徽章渲染 |
| `src/test/hooks/usePromptPlaza.test.tsx` | hook 状态机：loading → loaded → dirty → saving → saved → error |

测试纪律：RTL 真实 DOM，api 走 `vi.mock("../api/client")` 但断言**返回值与 UI 状态**而非「调用了几次」；dirty 检测走真实 fireEvent.change，不 snapshot 对象引用。

### 7.3 验收标准

1. 用户从首页点「提示词广场」→ 全屏 modal 打开
2. 看到 24 个提示词按分类分组，已自定义的有徽章
3. 点开任一提示词 → 看到 system_prompt 和 user_prompt_template 两个可编辑大文本框 + 折叠的高级项
4. 改 system_prompt 一行字 → 点保存 → JSON 文件出现该条目，下次重新打开看到徽章
5. 点「重置为默认」→ JSON 里该条目被移除
6. 浏览器开发者工具看 `PUT /api/projects/{id}/prompts/scene_writing` 一次成功请求
7. 现有所有 backend pytest 通过 + frontend vitest 通过
8. `BaseAgent.load_prompt("scene_writing")`（不传 project_id）行为完全不变 — 由 `test_load_prompt_with_override.py` 守住

---

## 八、文件清单

### 8.1 新增文件

**后端：**
- `backend/api/prompt_plaza.py`
- `backend/services/prompt_override_store.py`
- `backend/services/__init__.py`（如不存在）
- `tests/test_prompt_override_store.py`
- `tests/test_prompt_plaza_api.py`
- `tests/test_load_prompt_with_override.py`

**前端：**
- `frontend/src/api/promptPlaza.ts`
- `frontend/src/hooks/usePromptPlaza.ts`
- `frontend/src/components/home/promptPlaza/PromptPlazaModal.tsx`
- `frontend/src/components/home/promptPlaza/PromptListPanel.tsx`
- `frontend/src/components/home/promptPlaza/PromptEditPanel.tsx`
- `frontend/src/components/home/promptPlaza/AdvancedSection.tsx`
- `frontend/src/test/promptPlaza/PromptPlazaModal.test.tsx`
- `frontend/src/test/promptPlaza/PromptListPanel.test.tsx`
- `frontend/src/test/promptPlaza/PromptEditPanel.test.tsx`
- `frontend/src/test/hooks/usePromptPlaza.test.tsx`

### 8.2 修改文件

- `backend/main.py`（注册 router）
- `backend/agents/base_agent.py`（`load_prompt` 新签名、`__init__` 新参数）
- `frontend/src/components/home/QuickActions.tsx`（启用 `qa-prompt-square`）

### 8.3 不修改文件

- `backend/prompts/**`（YAML 永远只读）
- 现有所有 agent 文件（writer / reviewer / character_designer / 等）— 不传 project_id，行为不变

---

## 九、未来扩展（不在本 spec）

- **v1.x：项目级覆盖真正生效** — 在 writer / reviewer / character_designer 等 agent 构造时传入 `project_id`，让用户编辑的提示词真正影响生成结果
- **v2：版本历史 + 回滚** — 从 JSON 升级到 SQLite，加 version 表、diff UI、回滚按钮
- **v2：变量提取 / sandbox dry-run** — 解析 `{var}`、校验模板渲染、提供预览
- **v3：跨项目模板共享 / 导入导出** — 复刻 plotPilot 的 import/export 流程
- **v3：工作台顶栏入口** — 在 workspace top bar 也加入口，配合 v1.x 的「项目级覆盖真正生效」一起做