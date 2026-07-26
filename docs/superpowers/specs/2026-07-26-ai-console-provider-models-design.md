# AI 控制台 · Provider & Model 重组 — Implementation Spec

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 把 `config/model_tiers.yaml` 里散落在 tier 中的模型元数据收拢到 `providers` 顶层，让 AI 控制台支持新增 / 编辑 / 删除 provider 及其模型；同时支持 API Key 在控制台录入并落盘到 `backend/.env`，变更后实时生效。tier 与 agent_mapping 仍然通过「全局唯一 model id」引用模型。

**Architecture:** 在现有 `llm_config` 服务之上扩展：

- YAML 新增 `providers:` 顶层，承载 provider 类型、base URL、API Key 环境变量名、enabled 标志及其 `models` 子表。
- `validate()` 新增跨 provider 模型 id 唯一性、引用一致性、`enabled` 一致性、删除冲突校验。
- 后端新增 provider / model 增删改端点、API Key 写入与 reload、迁移触发端点。
- `ModelRouter` 装载 `_providers` 字典，模型元数据查找直接命中 provider catalog；新增 `MockProvider` 适配器（仅测试）。
- 前端 `ProviderPanel` 从只读升级为完整 CRUD；`TierPanel` 改为引用 provider 中的模型 id（白名单选择，不再编辑元数据）。
- 旧 YAML（无 `providers` 顶层）在第一次启动时一次性自动迁移到新结构，并同步 `backend/.env`；保留 `.bak-<timestamp>` 备份。

**Tech Stack:** 与现有 AI 控制台一致（FastAPI + Pydantic v2；React 18 + Tailwind）。

---

## 1. User-facing surface

### 入口
沿用现有 `qa-ai-console` 按钮 → `AIConsoleModal`。

### 新增 / 修改的交互

- **Provider 卡片（每张卡片）**
  - 顶部信息条：display_name、type（anthropic / openai_compatible / mock）、base_url、enabled 开关。
  - 「API Key」按钮：弹出模态框，输入新 Key（仅写入，不回显旧值），提交后立即 reload。
  - 「编辑 provider」按钮：行内修改 display_name / type / base_url / api_key_env / enabled。
  - 「删除 provider」按钮：删除遇引用时弹错误 toast，列出引用点。
  - 卡片下方「模型」子表：
    - 每行：id、display_name、cost_per_1k_input/output、max_tokens、temperature、json_mode、stream。
    - 行内操作：编辑 / 删除；删除遇引用时同样弹错误 toast。
    - 「+ 新增模型」行内按钮。

- **+ 新增 Provider**（顶部按钮）：表单同上字段。

- **Tier 面板**
  - 「models」行改为从 provider catalog 中挑选（autocomplete / 多选）；不再展示 cost / max_tokens 等元数据。
  - 「default」「fallback」下拉仅展示当前 tier `models` 白名单。

- **Agent Mapping 面板**：保持原交互，下拉数据源自动跟随 tier 白名单变化。

- **首次启动迁移提示**
  - 若读取到的 YAML 不含 `providers` 顶层且通过旧结构识别规则，弹「检测到旧配置，点击迁移」按钮。
  - 点击后调用 `POST /api/settings/llm-config/migrate`；成功后刷新界面并 toast「迁移完成」。

---

## 2. YAML Schema（新）

```yaml
providers:                              # 新顶层
  anthropic:
    type: anthropic                     # anthropic | openai_compatible | mock
    display_name: Anthropic
    base_url: https://api.anthropic.com
    api_key_env: ANTHROPIC_API_KEY
    enabled: true
    models:
      claude-opus-4:
        display_name: Claude Opus 4
        cost_per_1k_input: 0.015
        cost_per_1k_output: 0.075
        max_tokens: 8192
        temperature: 0.7
        json_mode: false
        stream: true
  deepseek:
    type: openai_compatible
    base_url: https://api.deepseek.com/v1
    api_key_env: DEEPSEEK_API_KEY
    enabled: true
    models:
      deepseek-v4-pro:
        display_name: DeepSeek V4 Pro
        cost_per_1k_input: 0.001
        cost_per_1k_output: 0.002
        max_tokens: 8192
        temperature: 0.7
        json_mode: true
        stream: true
tiers:
  tier_1:
    description: 创意核心
    default: deepseek-v4-pro            # 全局唯一 model id
    fallback: claude-opus-4
    models:                              # 白名单（model id 列表）
      - deepseek-v4-pro
      - claude-opus-4
    retry_on_failure: true
    max_retries: 1
  tier_2: {...}
  tier_3: {...}
  tier_0:                                # 保持锁定
    description: 确定性层（无 LLM）
    default: none
    fallback: null
    models: []
    retry_on_failure: false
    max_retries: 0
agent_mapping:
  writer.scene_writing:
    tier: tier_1
    model: default                       # 'default' 或 model id
    fallback: claude-opus-4
```

约束：
- `providers` 是 dict，按 key 字典序写入。
- `tiers.<name>.models[]` 是引用该 tier 可选的 model id 白名单；`default` / `fallback` 必须 ∈ 此白名单。
- 模型 id 在全部 `providers.*.models` 内全局唯一；冲突时校验直接拒绝。
- `tier_0` 仍保持 `default: none`、`fallback: null`、`models: []`。

---

## 3. 自动迁移

触发条件：

- 启动时检测 `config/model_tiers.yaml` 不含 `providers:` 顶层，但包含 `tiers.*.models[*].provider` 字段，视为旧结构。
- 或前端用户点击「迁移」按钮。

迁移步骤：

1. 备份原文件：`config/model_tiers.yaml.bak-<UTC-timestamp>`。
2. 按 `tiers.*.models[*].provider` 聚合 provider：
   - `anthropic` → `type: anthropic`、`base_url: https://api.anthropic.com`、`api_key_env: ANTHROPIC_API_KEY`。
   - 其它 → `type: openai_compatible`、`base_url` 使用现有 `deepseek_base_url` / `minimax_base_url` 默认值；`api_key_env: <UPPER>_API_KEY`。
3. 检查全局 model id 唯一性；若冲突，加 provider 前缀并同步更新所有 `tiers.*.models[*].id`、`tiers.<name>.default`、`tiers.<name>.fallback`、`agent_mapping.*.model`、`agent_mapping.*.fallback`。
4. 按现有 `provider_*_api_key` 字段写入 `backend/.env`，新增 `STORYFORGE_PROVIDER_API_KEY_<UPPER_ID>` 键（保留老键以兼容）。
5. 写入新 `config/model_tiers.yaml`（按 key 字典序）。
6. `ModelRouter.reload_config()`。

失败处理：

- 迁移失败抛出 `LLMConfigError`；启动不中断但 `reload_router` 走原 YAML 备份文件，错误写到日志与控制台 toast。
- 备份保留：用户可手动恢复。

---

## 4. 后端改动

### 4.1 `backend/services/llm_config.py`

- 新增 Pydantic 模型：`ProviderEntry`、`ModelEntry`、`ProvidersConfig`。
- `validate(data)` 扩展：
  - 校验 `providers` dict；每个 provider 的 `type ∈ {anthropic, openai_compatible, mock}`，必填字段非空。
  - 全局模型 id 唯一：`providers.*.models[*].id` 无重复。
  - `tiers.*.default` / `fallback` / `models[]` 引用的 model id 都必须在 `providers.*.models` 存在。
  - `agent_mapping.*.model` / `fallback` ∈ 所在 tier `models` 白名单。
- 新增 `find_references(data, target)`：
  - target 形式 `provider:<id>` 或 `model:<id>`。
  - 返回 `["tiers.tier_1.fallback", "agent_mapping.writer.scene_writing.model", ...]`。
- `validate_removal(data, target)`：调用 `find_references`，存在引用则 raise `LLMConfigError(invalid_paths=[...])`。
- `provider_status()` 改造为遍历 `providers.*`，返回 `{provider, type, base_url, api_key_env, api_key_configured, enabled, models: [{id, display_name, ...}]}`。
- `write_env_atomic(env_path, updates: dict[str, str])`：
  - 按行解析现有 env；匹配键名替换值；保留其它键与顺序；写 `.tmp` → `os.replace`。
  - 写入失败时清理 `.tmp`。
- `update_provider_api_key(provider_id: str, value: str)`：写 `STORYFORGE_PROVIDER_API_KEY_<UPPER_ID>`。
- `migrate_legacy_yaml()`：执行 §3 流程，返回 `{backup_path, summary}`。

### 4.2 `backend/llm/model_router.py`

- `BUILTIN_TIERS` 拆为 `BUILTIN_PROVIDERS` + `BUILTIN_TIERS`；seed 流程保持「文件不存在时写入」。
- `_providers: dict[str, ProviderEntry]`；`reload_config` 一并清空与重载。
- `_find_model_info(model_id)` 直接命中 `_providers.*.models[model_id]`；找不到时维持原 fallback 行为。
- `_create_provider_for_model`：
  - 当 `type=anthropic` → `AnthropicProvider`。
  - 当 `type=openai_compatible` → 根据 provider id 选用 `DeepSeekProvider` / `MiniMaxProvider`；其它 provider id 走新建的 `OpenAICompatibleProvider`（共用 OpenAI SDK，按 `base_url` 调用）。
  - 当 `type=mock` → 新建 `MockProvider`（仅测试，返回固定字符串，不联网）。
- `load_config()` 启动时如检测到旧结构，调 `migrate_legacy_yaml`，结果写到日志。

### 4.3 `backend/api/llm_config_api.py`

新增端点（保留原有 GET / PUT / reload / usage）：

- `POST /api/settings/llm-config/providers`：新增 / 修改 provider（body = `{provider: {...}}`）。先读取 YAML → 修改 `providers.<id>` → `validate()` → `write_yaml_atomic` → `reload_router`。
- `DELETE /api/settings/llm-config/providers/{provider_id}`：`validate_removal(data, "provider:<id>")` 通过后再删除；422 时返回 `invalid_paths`。
- `POST /api/settings/llm-config/providers/{provider_id}/models`：新增 / 修改 model。
- `DELETE /api/settings/llm-config/providers/{provider_id}/models/{model_id}`：`validate_removal(data, "model:<id>")`。
- `PUT /api/settings/llm-config/providers/{provider_id}/api-key`：body = `{value}`，调 `update_provider_api_key` → `write_env_atomic` → `reload_router`。
- `POST /api/settings/llm-config/migrate`：仅在 YAML 不含 `providers` 顶层时返回 200+摘要；否则 409。

错误格式保持 `{error, code, message, detail: {invalid_paths: [...]}}`。

### 4.4 `backend/llm/openai_compatible_provider.py`

新增 `OpenAICompatibleProvider`，与 `DeepSeekProvider` / `MiniMaxProvider` 行为一致，但 `base_url` 完全来自 provider 配置（无默认值 fallback）。复用 `openai.AsyncOpenAI` 客户端。

### 4.5 `backend/llm/mock_provider.py`

新增 `MockProvider`，构造时接收固定返回文本；`generate` 直接返回 `LLMResponse(text=...)`，不调用网络。

### 4.6 `backend/main.py`

注册新增 provider；`reload_router()` 不变。

---

## 5. 前端改动

### 5.1 `frontend/src/api/client.ts`

- 扩展 `ModelEntry` 类型（`display_name`、`temperature`、`json_mode`、`stream` 等）。
- 新增 `ProviderEntry` / `ProvidersConfig` 类型。
- 新增端点包装：`addProvider`、`updateProvider`、`deleteProvider`、`addModel`、`updateModel`、`deleteModel`、`setProviderApiKey`、`migrateConfig`。
- `getProviders` 返回类型同步更新。

### 5.2 `frontend/src/api/llmConsole.ts`

透传新方法。

### 5.3 `frontend/src/components/aiConsole/ProviderPanel.tsx`

- 头部「+ 新增 Provider」按钮。
- 每张 provider 卡片支持展开 / 收起「模型」子表。
- 行内编辑：display_name、type、base_url、api_key_env、enabled。
- 「API Key」按钮：模态框输入框（type=password，不回显）；提交后立即 reload 并 toast。
- 删除按钮：遇引用时 toast 显示 `tiers.tier_1.fallback`、`agent_mapping.writer.scene_writing.model` 等。
- 卡片数量 > 6 时改列表视图（保留搜索过滤）。

### 5.4 `frontend/src/components/aiConsole/TierPanel.tsx`

- `tier.models` 行改为「多选 from provider catalog」：autocomplete / 多选下拉。
- 「default」「fallback」下拉数据源改为当前 tier `models` 白名单。
- 不再展示 cost / max_tokens 元数据；保留 description、retry_on_failure、max_retries 字段。

### 5.5 `frontend/src/components/aiConsole/AgentMappingPanel.tsx`

- `modelOptionsForTier` 数据源改用 `tier.models[]` 白名单。
- 行为不变。

### 5.6 `frontend/src/components/aiConsole/AIConsoleModal.tsx`

- `refresh()` 同时拉取新 providers 结构（含元数据）。
- 检测到 YAML 不含 `providers` 字段时显示「迁移」按钮与提示文案。
- dirty 检测保持 `JSON.stringify` 对比；新增 provider/model 增删改触发 dirty。

---

## 6. 错误处理 & 边界条件

- 校验失败统一 422 + `detail.invalid_paths`；前端 toast 展示具体路径，字段标红。
- 删除冲突：返回引用路径列表，前端展示位置详情。
- API Key 写入失败：回滚 `.env`，提示「请检查文件权限」；reload 失败但 env 写成功时提示「配置已落盘，请手动刷新」。
- 自动迁移失败：保留 `.bak-<timestamp>` 备份；启动不中断，但日志 + 控制台 toast 提示。
- 运行时找不到模型：`ModelRouter._find_model_info` 抛 `ModelNotFoundError`；usage 表中标记 `provider=unknown`、`error=model_not_found`。
- 并发：单字段替换采用「读取 → 合并 → 写入」循环 3 次；最后一次校验失败则提示「请重试」。

---

## 7. 测试计划

### 后端

- `tests/test_llm_config_service.py`
  - 新增：providers dict 校验、全局模型 id 唯一校验、tier 引用校验、agent_mapping 引用校验。
  - 新增：`find_references`、`validate_removal` 单元测试。
  - 新增：`migrate_legacy_yaml` 单元测试（覆盖旧→新、id 冲突加前缀、env 同步、备份保留）。
- `tests/test_llm_config_api.py`
  - 新增端点用例：provider 增删改、model 增删改、api_key 设置、迁移触发、删除冲突 422。
- `tests/test_model_router.py`（如不存在则新建）
  - 覆盖 `_providers` 装载、运行时查找、MockProvider 调用不联网。

### 前端

- `ProviderPanel.test.tsx`：provider CRUD、model CRUD、删除冲突、API Key 弹窗、迁移按钮显示。
- `TierPanel.test.tsx`：tier.models 多选、白名单约束。
- `AgentMappingPanel.test.tsx`：覆盖新数据源。
- `AIConsoleModal.test.tsx`：迁移提示、ProviderPanel 变更触发 dirty、reload 按钮。

### 手工验证

- proj_cc4ca4ae 等现有项目：重启 → 自动迁移 → 继续推进写作；reload 实时生效。
- 手动构造引用冲突并尝试删除，确认 toast 信息准确。
- 切换 `mock` provider 并写场景测试，确认 MockProvider 不发网络请求。

---

## 8. 实施分阶段

1. **数据结构 + 自动迁移**：YAML schema、`migrate_legacy_yaml`、`.env` 同步、备份。
2. **后端 Provider/Model CRUD 端点 + 校验 + 删除冲突**：含 `OpenAICompatibleProvider` 与 `MockProvider`。
3. **`ModelRouter` 改造**：`_providers` 装载、查找逻辑、迁移触发。
4. **前端 ProviderPanel 改写 + TierPanel 调整 + 迁移提示**。
5. **测试补齐 + 老项目实际迁移验证**。