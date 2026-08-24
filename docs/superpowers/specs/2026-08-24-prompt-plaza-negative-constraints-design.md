# 提示词广场「约束性负面清单」设计

> **For agentic workers:** 在已上线的 Prompt Plaza（v1.9，commit 见 `docs/superpowers/specs/2026-07-19-prompt-plaza-design.md`）上增加一个独立字段 `negative_constraints`，让用户为自己重复遇到的 LLM 错误手写一份「禁止事项」清单，作为单独的提示词块注入到 LLM 调用。

**Branch:** v2.2
**Parent doc:** `2026-07-19-prompt-plaza-design.md`（v1.9 已落地的提示词广场基础架构）
**变更类型:** 增量扩展，不改现有 3 层合并语义

---

## 一、目标与非目标

### 目标
1. 在 Prompt Plaza 的每个 prompt 编辑面板里新增「负面清单 / 禁止事项」textarea，按现有 3 层覆盖（YAML → Global → Project）保存。
2. 后端 renderer 把该字段以 `【禁止事项】` 区块的形式注入到 `system_prompt` 中由作者定义的占位符位置；为空则彻底不渲染（不留占位符空白）。
3. 提供端到端单元测试覆盖：渲染、合并、空值处理、向后兼容。
4. 一次 PR 覆盖全部已列出的 YAML 提示词（~12 个），确保一致性。

### 非目标
- 不做违规检测自动闭环（「半自动 / 全自动」已与用户确认排除）。
- 不做结构化条目（分类 / 严重度 / 示例反例）— 自由文本已满足。
- 不做全局注入开关（用户已选 per-prompt 独立）。
- 不动 `voice_signature` / `unknown_to_character` / `taboo_constraints` 等既有约束机制。
- 不动 Prompt Plaza 的模态框外壳、列表面板、API 形状（仅在 payload 中加一个可选字段）。

---

## 二、架构

```
┌──────────────────────────────────────────────────────────────────┐
│                       PromptEditPanel                              │
│                                                                    │
│  SystemPromptSection  ←   UserPromptTemplateSection  ←  NEW ↓    │
│                                                       Negative*   │
│                                                       Section     │
│                                                                    │
│                                                       ↓            │
│                                                  AdvancedSection   │
└──────────────────────────────────────────────────────────────────┘
                              │ PUT /api/projects/{id}/prompts/{name}
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│              PromptOverrideStore.set_override(...)                 │
│                ↳ 在 3 层 merge 输出里多一个字段                      │
│                                                                    │
│  base = yaml_prompt                                                │
│  override = global_override ∪ project_override                     │
│  effective = {**base, **override}                                  │
│  effective.negative_constraints  ← 新增顶层字段                    │
└──────────────────────────────────────────────────────────────────┘
                              │ load_prompt_effective(name, project_id)
                              ▼
┌──────────────────────────────────────────────────────────────────┐
│              BaseAgent._format_system(...)                          │
│                                                                    │
│  1. _render_negative_block(effective.negative_constraints)         │
│     → 空串 / 非空【禁止事项】区块                                  │
│  2. 若空 → system_prompt.replace("{negative_constraints}", "")     │
│     若非空 → format_system(negative_constraints=rendered)           │
│                                                                    │
└──────────────────────────────────────────────────────────────────┘
```

---

## 三、数据模型与合并

### 字段形状

每个 prompt 记录现在的形状：

```python
class PromptOverridePayload:
    system_prompt: str
    user_prompt_template: str
    negative_constraints: str = ""   # ← 新增
    temperature: float | None = None
    max_tokens: int | None = None
    output_format: str | None = None
```

`negative_constraints` 类型是 `str`，默认 `""`，无格式限制。**任何层级写入空白字符都属于「未设置」。**

### 渲染辅助函数（新增）

```python
# backend/services/prompt_override_store.py
def render_negative_block(value: str) -> str:
    """
    Trim each line, drop empty lines, render as:
        \\n\\n【禁止事项】\\n- 规则1\\n- 规则2
    Returns "" if input is empty / whitespace-only.
    """
    lines = [ln.strip() for ln in value.splitlines() if ln.strip()]
    if not lines:
        return ""
    body = "\n".join(f"- {ln}" for ln in lines)
    return f"\n\n【禁止事项】\n{body}"
```

### 占位符替换与空值清理（在 BaseAgent 内做）

```python
# backend/agents/base_agent.py — load_prompt 返回前
rendered = render_negative_block(prompt_dict.get("negative_constraints", ""))
system_prompt = prompt_dict["system_prompt"]
if rendered:
    prompt_dict = {**prompt_dict, "negative_constraints": rendered}
else:
    # 关键：彻底从 system_prompt 里删掉占位符，避免 LLM 看到一个空的占位符行
    system_prompt = system_prompt.replace("{negative_constraints}", "").rstrip() + "\n"
    prompt_dict = {**prompt_dict, "system_prompt": system_prompt,
                   "negative_constraints": ""}
```

`rendered` 为空时把 `negative_constraints` 设为 `""`，是为了让 `format_system(**kwargs)` 不论 YAML 是否声明占位符都不会 KeyError。

### 3 层合并行为

沿用现有 `{**base, **override_fields}`：
- YAML `negative_constraints: ""` → base 为 `""`
- Global override 写入 `"rule X"` → effective `"rule X"`
- Project override 写入 `"rule X\nrule Y"` → effective `"rule X\nrule Y"`

空字符串被 merge 覆盖上去不影响其他字段（Python `{**base, "negative_constraints": ""}` 等价于 base）。

---

## 四、YAML 迁移

### 范围

| 目录 | 候选文件（实施时 `ls backend/prompts/**/*.yaml` 最终定） |
|---|---|
| `backend/prompts/` | `scene_writing.yaml`, `scene_rewrite.yaml`, `outline_generation.yaml`, `novel_outline_generation.yaml`, `chapter_summary.yaml`, `planner_chapter_outline.yaml`, `narrative_guard.yaml`, `fact_guard_review.yaml`（如存在）|
| `backend/prompts/creative/` | `creative_director_planning.yaml`, `whatif_expand.yaml` 等 |
| `backend/prompts/character_designer/` | `character_profile.yaml` 等 |
| `backend/prompts/style_engine/` | `style_extraction.yaml` 等 |

### 每个 YAML 两处改动

1. 新增顶层字段：`negative_constraints: ""`
2. 在 `system_prompt` 末尾（默认；少数 prompt 可视情况调整）新增一行：`{negative_constraints}`

位置选择原则：
- **不要**插在 `system_prompt` 最末尾「必须输出 SF_LOG」之类强兜底指令之后，否则会被挤出去
- **优先**插在已有「行为禁忌 / 知识泄漏禁止」类引导段之后、SF_LOG 兜底之前
- 实施时人工逐文件判断；不写脚本批量改

### 软上限

用户输入 `negative_constraints` 长度（trim 后字符数）超过 1500 字符时，UI 显示警告文字与 token 估算：

```
该清单预计 ~N tokens。超过 1500 字符可能挤占提示词上下文预算。
```

不在后端强制截断；保留用户决定权。token 估算用 1 中文字符 ≈ 1.5 tokens 粗估。

---

## 五、API & 存储

### 后端

| 文件 | 改动 |
|---|---|
| `backend/api/prompt_plaza.py` | `PromptOverridePayload` 加 `negative_constraints: str = ""` |
| `backend/api/prompt_defaults.py` | 同上 |
| `backend/services/prompt_override_store.py` | (1) `PromptOverrideStore` save/load 字段；(2) 新增 `render_negative_block(value)` 模块级函数；(3) `load_prompt_effective` 输出包含此字段 |
| `backend/agents/base_agent.py` | `load_prompt` 返回前执行 §三 中的「渲染 + 空值清理」两步 |

### 现有 3 层 JSON 文件

- `config/global_prompt_overrides.json`
- `projects/{project_id}/prompt_overrides.json`

老 JSON 不含 `negative_constraints` 字段，merge 时视为 `""`，行为等同于「不设」。**无需数据迁移脚本**。

### 前端

| 文件 | 改动 |
|---|---|
| `frontend/src/api/promptPlaza.ts` | `PromptSummary` / `PromptDetail` / `PromptOverridePayload` 等接口加 `negative_constraints?: string`；`putPlazaPrompt` / `putDefaultPrompt` payload 同步加字段（保持可选，缺省视为 `""`）|
| `frontend/src/components/home/promptPlaza/PromptEditPanel.tsx` | 新增 `<NegativeConstraintsSection>` 子组件（textarea + 字符计数 + 软上限警告）插入到 UserPromptTemplateSection 与 AdvancedSection 之间 |
| `frontend/src/components/home/promptPlaza/PromptEditPanel.tsx` | dirty diff 与 Reset 现有逻辑已覆盖新字段 |

UI 文本（中文）：
- 标题：「负面清单 / 禁止事项」
- 占位提示：「一行一条规则。例：不要使用回合制战斗描写」
- 副提示：「会作为 `【禁止事项】` 区块注入到系统提示词末尾的占位符位置。空则不注入。」

---

## 六、测试

### 后端：`tests/test_prompt_override_negative_constraints.py`（新建）

| 用例 | 断言 |
|---|---|
| `test_render_empty_input_returns_empty` | `""` / 全空白 / 全空行 → 函数返回 `""` |
| `test_render_three_lines` | 三行规则 → 产出 `\n\n【禁止事项】\n- 规则1\n- 规则2\n- 规则3` |
| `test_render_trims_individual_lines` | 行内缩进 → trim 后输出 |
| `test_three_tier_merge_yaml_to_global` | YAML `""` + Global `"ruleX"` → effective `"ruleX"` |
| `test_three_tier_merge_global_to_project` | Global `"ruleX"` + Project `"ruleX\nruleY"` → effective `"ruleX\nruleY"` |
| `test_empty_value_strips_placeholder_cleanly` | YAML 含 `{negative_constraints}` 且 user value 为空 → 发送给 LLM 的 system_prompt 里**不**出现 `{negative_constraints}` 也不出现空占位符行 |
| `test_no_yaml_placeholder_value_not_leaked` | YAML 没有 `{negative_constraints}` 但 user 有值 → 发送给 LLM 的 prompt 里**不**出现（方案 B：隐式追加不存在） |
| `test_existing_advanced_merge_unchanged` | temperature / max_tokens / output_format 合并逻辑不受影响 |
| `test_real_scene_writing_e2e_format` | 用真实 `scene_writing.yaml` + user 填值 → 调用 `load_prompt + format_system`，断言最终 system_prompt 文本包含 `【禁止事项】` 且后续 SF_LOG 兜底指令完整保留 |

### 前端：`frontend/src/components/home/promptPlaza/__tests__/PromptEditPanel.test.tsx`

| 用例 | 断言 |
|---|---|
| `renders negative_constraints textarea` | 字段出现、标题 / placeholder 正确 |
| `saves negative_constraints in PUT body` | dirty 修改 → submit → payload 含字段 |
| `reset clears negative_constraints` | Reset 触发 → 字段回到 effective 值 |
| `shows warning over 1500 chars` | 字数超阈值 → 警告文字可见 |

### 端到端手测（不自动化，提 PR 时跑一遍）

1. HomePage 模态框给 `scene_writing` 写 2 条 → 项目里跑一章 → 草稿不含对应错误模式
2. Workspace 模态框给 `outline_generation` 写 1 条 → 重生大纲 → 输出不命中
3. 故意写全空白 / 全空行 → 保存 → 回看面板 → 数据已 trim

---

## 七、风险与边界

| 风险 | 应对 |
|---|---|
| Token 预算膨胀（每条规则 ~10-50 tokens） | UI 软上限警告 + 字符计数；不强制截断 |
| 用户错把「禁止」写进 system_prompt 文本 | dirty diff 已经高亮系统提示词的修改，自带反馈 |
| YAML 改占位符后老项目覆盖 JSON 兼容性 | merge 默认 `""`，无破坏性变更 |
| 占位符清理逻辑漏处理某一边角情况（如占位符出现在字符串字面量里） | Yaml 文件里 `{negative_constraints}` 只在 system_prompt 中插入，整篇 grep 一次确认无其它出现位置 |
| 新字段影响现有端到端单测 | `test_existing_advanced_merge_unchanged` 守门；其他相关测试不依赖 system_prompt 字面 |

---

## 八、文件改动清单（实施预期）

**新建：**
- `tests/test_prompt_override_negative_constraints.py`
- `frontend/src/components/home/promptPlaza/__tests__/PromptEditPanel.test.tsx`（如该目录不存在则新建子目录）

**修改：**
- `backend/prompts/**/*.yaml`（~12 个）
- `backend/agents/base_agent.py`
- `backend/api/prompt_plaza.py`
- `backend/api/prompt_defaults.py`
- `backend/services/prompt_override_store.py`（新增 module-level `render_negative_block` 函数）
- `frontend/src/api/promptPlaza.ts`
- `frontend/src/components/home/promptPlaza/PromptEditPanel.tsx`

**不动：**
- `config/global_prompt_overrides.json`（运行时自动写入）
- `projects/{id}/prompt_overrides.json`（运行时自动写入）
- Plaza 的模态框、列表、API 路由形状、BaseAgent 其他机制
