# Genre Temperature 生效方案 — 设计

> 适用范围：让 `config/genres/<id>.yaml` 中已有的 `model_preferences.temperature` 7 个题材值在 tier_1（创作链路）LLM 调用里真正生效。
> 优先级：**sandbox > prompt > genre > settings fallback**（更具体的覆盖更通用的）。
> 不打 warning；缺省静默 fallback 到 `settings.llm_temperature = 0.7`。

---

## 1. 背景与目标

### 1.1 当前状态（已验证）

- `config/genres/<id>.yaml` 7 份题材已定义 `model_preferences.temperature`，值分别为：
  - cool_novel: 0.9, xuanhuan: 0.9, xianxia: 0.85, dushi: 0.85, yanqing: 0.85, kehuan: 0.8, xuanyi: 0.75
- `backend/agents/base_agent.py:25` 把 prompt YAML 的 `temperature` 字段读入 `PromptTemplate.temperature`，默认值 `settings.llm_temperature`
- `backend/agents/base_agent.py:190/199/245` 把 `prompt.temperature` 作为 kwargs 透传给 `router.execute()`
- `backend/llm/model_router.py:421-428` 把 `**kwargs` 透传给 `provider.generate()`
- `backend/llm/deepseek_provider.py:19`、`minimax_provider.py:49`、`openai_compatible_provider.py:56`：provider 已支持 `temperature` kwarg
- **`model_preferences.temperature` 无任何代码读取**——纯死配置

### 1.2 目标

- 7 个 `model_preferences.temperature` 在 tier_1 agent 调用中真正生效
- 与现有 `prompt.temperature`、`sandbox.temperature` 路径兼容不冲突
- tier_2/3 agent 保持现状（prompt-only）
- 静默运行，无 warning，无 review 字段污染
- 题材缺字段时 fallback 到 `settings.llm_temperature = 0.7`，零回归

---

## 2. 架构

| 层 | 改造点 | 文件 |
|---|---|---|
| 数据层 | 无改动 | `config/genres/*.yaml` |
| Catalog | 已有 `get(genre)` 返回完整 dict，含 `model_preferences` | 无改动 |
| BaseAgent | 加 `_resolve_temperature` helper + `_is_tier_1_agent` helper + `__init__` 加 `genre` 参数 | `backend/agents/base_agent.py` |
| Tier 判定 | 复用 `model_router._get_mapping(agent_name, task_name)`（已存在） | `backend/llm/model_router.py`（无改动） |
| Agent 构造点 | 5 处 tier_1 agent 实例化多传 `genre=` | 详见 §2.5 |

---

## 3. 组件

### 3.1 `BaseAgent._resolve_temperature(prompt, custom_style_config)`

新方法，位于 `backend/agents/base_agent.py`。签名：

```python
def _resolve_temperature(
    self,
    prompt: "PromptTemplate",
    custom_style_config: Optional[dict] = None,
) -> float:
```

逻辑：
1. **Tier 过滤**：先调 `_is_tier_1_agent()`（见 §3.2）。若为 False，直接返回 `prompt.temperature`（保持现状）
2. **Sandbox**：`custom_style_config` 解析为 `SandboxParams`（已有模式：`backend/agents/writer.py:65` `_build_custom_style_desc`）。若 `params.temperature` 是 `(int, float)`，返回它
3. **Prompt**：`prompt.temperature` 是 `(int, float)`，返回
4. **Genre**：`get_catalog().get(self.genre).model_preferences.temperature` 是 `(int, float)`，返回
5. **Fallback**：`settings.llm_temperature`

每一步都用 `isinstance(val, (int, float))` 守卫（不接 bool，不接 str）。每一步都用 `try/except` 兜底（catalog 故障、sandbox 解析失败都不抛错）。

### 3.2 `BaseAgent._is_tier_1_agent()`

```python
def _is_tier_1_agent(self) -> bool:
    """Check if THIS agent (regardless of task_name) is tier_1 in model_tiers.yaml.

    Walks all task mappings for agent_name; returns True if ALL (or the single)
    mappings point to tier_1. Returns False on any non-tier_1 task or on lookup
    failure (router not initialized yet).
    """
    try:
        mappings = self.router._mappings.get(self.agent_name, {})
        if not mappings:
            return False
        tiers = {m.tier_name for m in mappings.values()}
        return tiers == {"tier_1"}
    except Exception:
        return False
```

**判定粒度**：agent 级别（不是 task 级别）。所有已知 tier_1 agent 都是单 tier 映射（planner、writer、creative_director、character_designer 都只跑 tier_1），所以 agent 级判定足够。tier_2/3 agent（如 reviewer、storyos_agent）有部分任务在 tier_2，需要保留旧行为——但**它们不是 tier_1**，agent 级判定会正确把它们排除。

**保守 fallback**：lookup 失败时返回 False，等同"走 prompt-only 旧路径"。

### 3.3 `BaseAgent.__init__` 新增 `genre` 参数

```python
def __init__(
    self,
    project_id: str,
    prompts_dir: Optional[Path] = None,
    model_router: Optional[ModelRouter] = None,
    override_store: Optional["PromptOverrideStore"] = None,
    global_override_store: Optional["GlobalPromptOverrideStore"] = None,
    genre: str = "cool_novel",  # NEW
):
    ...
    self.genre = genre
```

`cool_novel` 是 catalog 的 fallback 索引（`backend/genres/catalog.py:212`），未知 genre 会落到它身上——这与现有 catalog 行为一致。

### 3.4 `generate_from_template` 温度透传接入

`backend/agents/base_agent.py` 中 3 处 `temperature=prompt.temperature` 改为：

```python
temperature=self._resolve_temperature(prompt, custom_style_config),
```

分别位于：
- 行 ~190（`generate` 方法）
- 行 ~199（`generate_stream` 方法）
- 行 ~245（其他调用点）

`custom_style_config` 已是这些方法的命名参数；`PromptTemplate prompt` 也是。无新增参数。

### 3.5 Agent 构造点 wire

凡是构造 tier_1 agent 的位置都传 `genre=`：

| 文件 | 行 | 当前调用 | 改后 |
|---|---|---|---|
| `backend/api/stage1_concept.py` | ~61 | `PlannerAgent(project_id, ...)` | `PlannerAgent(project_id, ..., genre=project.get("genre", "cool_novel"))` |
| `backend/api/stage2_planner.py` | PlannerAgent 构造点 | 同上 |
| `backend/api/stage4_writing.py` | WriterAgent 构造点 | 同上 |
| `backend/agents/character_designer.py` | `CharacterDesignerAgent` 自构造 | 加 `genre=...` |
| `backend/agents/creative_director.py` | `CreativeDirectorAgent` 自构造 | 加 `genre=...` |

> `project.get("genre", "cool_novel")` 与 catalog 的 fallback 路径完全一致（catalog 未知 genre 时也落 cool_novel）。

实际行号和文件清单在 plan 阶段 grep 落实。

---

## 4. 优先级对照表

| prompt.temperature | sandbox.temperature | genre.temperature | 实际生效值 |
|---|---|---|---|
| 未设 | 未设 | 0.85 (xianxia) | **0.85**（题材温度生效） |
| 0.7 | 未设 | 0.85 | **0.7**（prompt 覆盖题材） |
| 0.7 | 0.5 | 0.85 | **0.5**（sandbox 覆盖 prompt） |
| 未设 | 0.5 | 未设 | **0.5**（sandbox） |
| 未设 | 未设 | 未设 | **0.7**（`settings.llm_temperature` fallback） |

tier_2/3 agent：忽略 sandbox 和 genre，只看 prompt.temperature → settings fallback。

---

## 5. 数据流（端到端）

```
1. API endpoint (e.g. /api/stage4/writing)
   ├─ read project.json → project["genre"]
   ├─ construct WriterAgent(project_id, genre="xianxia")
   └─ agent.write_scene(...)

2. WriterAgent inherits BaseAgent; self.genre = "xianxia"

3. writer.write_scene(...)
   └─ self.generate_from_template("scene_writing", custom_style_config=...)
        └─ PromptTemplate loaded (with temperature from YAML or override)

4. BaseAgent.generate_from_template(...)
   ├─ prompt = load_prompt_effective("scene_writing", ...)
   ├─ kwargs["temperature"] = self._resolve_temperature(prompt, custom_style_config)
   │    ├─ _is_tier_1_agent() → True (writer is tier_1)
   │    ├─ sandbox.temperature? → no (custom_style_config is None)
   │    ├─ prompt.temperature? → no (yaml 不写)
   │    ├─ catalog.get("xianxia").model_preferences.temperature → 0.85 ✅
   │    └─ return 0.85
   └─ await self.router.execute(temperature=0.85, ...)

5. router._execute_with_fallback
   └─ provider.generate(temperature=0.85, ...)
        └─ LLM call with temperature=0.85
```

---

## 6. 错误处理

| 场景 | 处理 |
|---|---|
| `_is_tier_1_agent()` 抛错（router 未初始化） | 返回 False → 走 prompt-only 旧路径 |
| `custom_style_config` 不是合法 SandboxParams | 解析 try/except 失败 → 走下一级（prompt → genre → fallback） |
| `prompt.temperature` 是 string / None / bool | isinstance 守卫拒绝 → 走下一级 |
| `self.genre` 未知（catalog fallback 到 cool_novel） | cool_novel.model_preferences.temperature = 0.9 |
| Catalog 抛错（YAML 损坏 / 加载失败） | try/except 兜底 → fallback 到 `settings.llm_temperature` |
| `_mappings[agent_name]` 不存在 | 返回 False（保守） |
| `genre` kwarg 在构造时未传 | 默认 `cool_novel`；不会 KeyError |

---

## 7. 测试

新增 `tests/test_genre_temperature.py`（仿 `tests/test_pacing_enforcement.py` 形态）。

### 7.1 TestGenreTemperatureResolution（5 用例）
- `test_genre_temperature_used_when_prompt_has_no_temperature`
- `test_prompt_temperature_overrides_genre`
- `test_sandbox_temperature_overrides_prompt_and_genre`
- `test_fallback_to_settings_when_all_unset`
- `test_invalid_genre_falls_back_to_settings_silently`

### 7.2 TestTierFiltering（3 用例）
- `test_tier_1_agent_uses_genre_temperature`
- `test_tier_2_agent_skips_genre_temperature`
- `test_tier_3_agent_skips_genre_temperature`

### 7.3 TestIntegration（2 用例）
- `test_resolve_temperature_matches_real_xianxia_value_0_85`
- `test_resolve_temperature_matches_real_cool_novel_value_0_9`

### 7.4 TestErrorHandling（2 用例）
- `test_catalog_failure_falls_back_silently`
- `test_invalid_sandbox_config_does_not_raise`

**总计 12 用例，4 个 class。** 通过 mock `PromptTemplate.temperature`、`self.genre`、`self.router._mappings` 即可，不需要真发起 LLM 调用。

---

## 8. YAGNI（明确不做）

- ❌ 不改 `router.execute()` 签名（不增加 `genre` 参数）
- ❌ 不改 `SandboxParams`（已有 temperature 字段）
- ❌ 不改 prompt YAML 形状
- ❌ 不做 task 级别 tier 判定（agent 级别足够）
- ❌ 不做运行时题材切换
- ❌ 不打 warning / 不写 review 字段
- ❌ 不动 `creative_core` 字段（model_preferences 的另一个字段，用户本次只要求 temperature）
- ❌ 不为 tier_2/3 接入题材温度（保持现状）

---

## 9. 文件清单

**新增**：
- `tests/test_genre_temperature.py`（~250 行，12 用例）

**修改**：
- `backend/agents/base_agent.py`（~60 行新增：`_resolve_temperature` + `_is_tier_1_agent` + `__init__` 加 `genre` + 3 处 kwargs 替换为 `self._resolve_temperature(...)`）
- 5 处 tier_1 agent 构造点：每处加 `genre=project.get("genre", "cool_novel")` 或从 `self.genre` 透传

**不改**：
- `config/genres/*.yaml`
- `backend/genres/catalog.py`
- `backend/llm/model_router.py`
- `backend/llm/base_provider.py`
- `backend/style_engine/sandbox_renderer.py`
- `backend/config.py`
- `backend/llm/__init__.py`
- 各 `provider/*.py` 文件
- `PromptTemplate` 数据类

---

## 10. 验收

- `pytest tests/test_genre_temperature.py -v` → 12/12 通过
- `pytest tests/` 全量回归，**无新增失败**（tier_2/3 agent 测试保持现状通过）
- 修改 `config/genres/xianxia.yaml` 的 `model_preferences.temperature` 从 0.85 → 1.2，运行任意 tier_1 agent 调用，logs/usage JSON 里 temperature=1.2
- 修改 `backend/prompts/novel_outline_generation.yaml` 添加 `temperature: 0.5`，运行 tier_1 agent，温度被覆盖为 0.5（即 prompt 优先于 genre）
- 在某 tier_2 agent（如 reviewer）调用中，题材 temperature 变化**不**影响实际 temperature（保持现状）