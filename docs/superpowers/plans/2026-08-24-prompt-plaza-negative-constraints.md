# Prompt Plaza 约束性负面清单 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为已上线的 Prompt Plaza 增加 `negative_constraints` 字段，让用户为每个 prompt 维护一份手写「禁止事项」清单，作为 `【禁止事项】` 区块注入到 system_prompt 中由作者指定的占位符位置。

**Architecture:** 新增顶层字段 `negative_constraints: str`（默认 `""`），并入既有 3 层合并（YAML → Global → Project）。BaseAgent 在 `load_prompt` 末尾做两步：(a) 调 `render_negative_block(value)` 渲染成 `【禁止事项】` 区块；(b) 渲染结果为空时从 `system_prompt` 里彻底删除 `{negative_constraints}` 占位符，避免空行残留。YAML 加 `{negative_constraints}` 占位符。

**Tech Stack:** FastAPI / Pydantic / pytest / React 18 + Vite + TypeScript / vitest

**Spec:** `docs/superpowers/specs/2026-08-24-prompt-plaza-negative-constraints-design.md`（commit `7626cd6`）

---

## File Structure

**Backend modified:**
- `backend/services/prompt_override_store.py` — 新增 `render_negative_block()` 模块级函数
- `backend/agents/base_agent.py:144-173` — `load_prompt` 内做两步处理
- `backend/api/prompt_plaza.py:26-35` — `PromptOverridePayload` 加字段
- `backend/api/prompt_defaults.py:30-39` — `PromptOverridePayload` 加字段
- `backend/prompts/**/*.yaml` — 25 个文件每个加 `negative_constraints: ""` + `system_prompt` 末尾加 `{negative_constraints}` 占位符

**Backend created:**
- `tests/test_negative_constraints.py` — TDD 测试（helper + BaseAgent + e2e）

**Frontend modified:**
- `frontend/src/api/promptPlaza.ts:23-29` — `PromptOverridePayload` 加 `negative_constraints?: string`
- `frontend/src/components/home/promptPlaza/PromptEditPanel.tsx` — 新增 `<NegativeConstraintsSection>`

**Frontend created:**
- `frontend/src/test/promptPlaza/PromptEditPanel.test.tsx` — 新增 vitest 套件

---

## Task 1: TDD `render_negative_block` helper 函数

**Files:**
- Modify: `backend/services/prompt_override_store.py`（末尾追加函数）
- Create: `tests/test_negative_constraints.py`

- [ ] **Step 1: 写失败测试**

新建 `tests/test_negative_constraints.py`：

```python
"""Tests for the negative_constraints render helper.

render_negative_block is a pure-string utility that BaseAgent.load_prompt
calls to turn a user's free-text list into the `【禁止事项】` block
substituted into {negative_constraints}.
"""

from backend.services.prompt_override_store import render_negative_block


def test_empty_string_returns_empty():
    assert render_negative_block("") == ""


def test_whitespace_only_returns_empty():
    assert render_negative_block("   ") == ""
    assert render_negative_block("\n\n") == ""
    assert render_negative_block("  \n  \n  ") == ""


def test_single_line_renders_with_header_and_bullet():
    assert render_negative_block("不要使用回合制战斗描写") == (
        "\n\n【禁止事项】\n- 不要使用回合制战斗描写"
    )


def test_multi_line_trims_drops_blanks_and_bullets():
    assert render_negative_block(
        "  不要使用回合制战斗描写  \n"
        "不要出现现代品牌名\n"
        "\n"
        "禁止元婴/金丹/筑基"
    ) == (
        "\n\n【禁止事项】\n"
        "- 不要使用回合制战斗描写\n"
        "- 不要出现现代品牌名\n"
        "- 禁止元婴/金丹/筑基"
    )
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
source venv/bin/activate && pytest tests/test_negative_constraints.py -v
```
Expected: `ModuleNotFoundError: cannot import name 'render_negative_block'`

- [ ] **Step 3: 实现函数**

追加到 `backend/services/prompt_override_store.py` 末尾（紧接 `reset_project_override_store` 之后）：

```python
def render_negative_block(value: str) -> str:
    """Format a free-text negative-constraint list as the `【禁止事项】` block.

    Returns "" when input is empty / whitespace-only so BaseAgent can
    decide not to substitute {negative_constraints} at all.
    """
    lines = [ln.strip() for ln in value.splitlines() if ln.strip()]
    if not lines:
        return ""
    body = "\n".join(f"- {ln}" for ln in lines)
    return f"\n\n【禁止事项】\n{body}"
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
source venv/bin/activate && pytest tests/test_negative_constraints.py -v
```
Expected: 4 passed.

- [ ] **Step 5: 提交**

```bash
git add backend/services/prompt_override_store.py tests/test_negative_constraints.py
git commit -m "feat(prompts): add render_negative_block helper for plaza constraints"
```

---

## Task 2: TDD BaseAgent 注入逻辑（含 e2e 端到端测试）

**Files:**
- Modify: `backend/agents/base_agent.py:144-173`
- Modify: `tests/test_negative_constraints.py`（追加 e2e 测试类）

- [ ] **Step 1: 追加失败 e2e 测试**

追加到 `tests/test_negative_constraints.py`：

```python
import json
import yaml
from pathlib import Path

import pytest

from backend.agents.base_agent import BaseAgent
from backend.services.prompt_override_store import (
    PromptOverrideStore,
    get_project_override_store,
    reset_project_override_store,
)


@pytest.fixture
def nc_prompts_dir(tmp_path):
    """Synthetic prompts dir with {negative_constraints} placeholder."""
    (tmp_path / "with_placeholder.yaml").write_text(yaml.safe_dump({
        "system_prompt": "DEFAULT_SYS\n{negative_constraints}\nTAIL",
        "user_prompt_template": "user",
        "temperature": 0.7,
        "max_tokens": 1000,
    }))
    (tmp_path / "without_placeholder.yaml").write_text(yaml.safe_dump({
        "system_prompt": "DEFAULT_SYS_NO_PC\nTAIL",
        "user_prompt_template": "user",
        "temperature": 0.7,
        "max_tokens": 1000,
    }))
    return tmp_path


@pytest.fixture
def nc_projects_dir(tmp_path):
    return tmp_path


def _agent(prompts_dir, projects_dir, project_id):
    return BaseAgent(
        project_id=project_id,
        prompts_dir=prompts_dir,
        override_store=PromptOverrideStore(
            projects_dir=projects_dir, prompts_dir=prompts_dir
        ),
    )


class TestNegativeConstraintsInjection:
    def test_with_placeholder_and_value_substitutes_block(
        self, nc_prompts_dir, nc_projects_dir
    ):
        proj = nc_projects_dir / "p1"
        proj.mkdir()
        (proj / "prompt_overrides.json").write_text(json.dumps({
            "with_placeholder": {
                "negative_constraints": "不要使用回合制战斗描写",
                "_modified_at": "x",
            }
        }))
        agent = _agent(nc_prompts_dir, nc_projects_dir, "p1")
        prompt = agent.load_prompt("with_placeholder", project_id="p1")
        out = prompt.format_system(negative_constraints="placeholder-supplied-here")
        # Default-side formatting kwarg is replaced by load_prompt's own value,
        # so the kwarg value here should not appear in output.
        assert "placeholder-supplied-here" not in out
        # The rendered block lives in system_prompt at the placeholder location.
        assert "【禁止事项】" in out
        assert "- 不要使用回合制战斗描写" in out
        # TAIL is still there (placeholder was substituted in-place).
        assert "TAIL" in out

    def test_with_placeholder_and_empty_strips_placeholder(
        self, nc_prompts_dir, nc_projects_dir
    ):
        proj = nc_projects_dir / "p2"
        proj.mkdir()
        (proj / "prompt_overrides.json").write_text(json.dumps({
            "with_placeholder": {
                "negative_constraints": "",
                "_modified_at": "x",
            }
        }))
        agent = _agent(nc_prompts_dir, nc_projects_dir, "p2")
        prompt = agent.load_prompt("with_placeholder", project_id="p2")
        out = prompt.format_system(negative_constraints="unused")
        # The placeholder and its newline are gone.
        assert "{negative_constraints}" not in out
        assert "【禁止事项】" not in out
        # The surrounding DEFAULT_SYS and TAIL lines stay adjacent (no empty
        # line where the placeholder used to live).
        assert "DEFAULT_SYS\nTAIL" in out or out.endswith("DEFAULT_SYS\nTAIL")

    def test_no_placeholder_and_value_does_not_leak(
        self, nc_prompts_dir, nc_projects_dir
    ):
        proj = nc_projects_dir / "p3"
        proj.mkdir()
        (proj / "prompt_overrides.json").write_text(json.dumps({
            "without_placeholder": {
                "negative_constraints": "不要使用回合制战斗描写",
                "_modified_at": "x",
            }
        }))
        agent = _agent(nc_prompts_dir, nc_projects_dir, "p3")
        prompt = agent.load_prompt("without_placeholder", project_id="p3")
        out = prompt.format_system(negative_constraints="unused")
        # Plan B: 无占位符绝不隐式追加。Value 不出现在 LLM prompt 里。
        assert "不要使用回合制战斗描写" not in out
        assert "【禁止事项】" not in out
        assert "DEFAULT_SYS_NO_PC\nTAIL" in out

    def test_no_placeholder_and_empty_preserves_yaml_exactly(
        self, nc_prompts_dir, nc_projects_dir
    ):
        agent = _agent(nc_prompts_dir, nc_projects_dir, "p4_no_override")
        prompt = agent.load_prompt("without_placeholder", project_id="p4_no_override")
        out = prompt.format_system(negative_constraints="unused")
        assert out == "DEFAULT_SYS_NO_PC\nTAIL"
```

- [ ] **Step 2: 运行新测试，确认失败**

```bash
source venv/bin/activate && pytest tests/test_negative_constraints.py::TestNegativeConstraintsInjection -v
```
Expected: 4 failures — output should contain `不要使用回合制战斗描写` / `【禁止事项】` but doesn't because load_prompt doesn't substitute yet.

- [ ] **Step 3: 修改 BaseAgent.load_prompt**

打开 `backend/agents/base_agent.py`，把现 `load_prompt` 方法（144-173 行）的最后两行：

```python
        data = load_prompt_effective(
            template_name,
            project_id=project_id,
            override_store=self._override_store,
            global_override_store=self._global_override_store,
            prompts_dir=self.prompts_dir,
        )
        return PromptTemplate(data)
```

替换成：

```python
        data = load_prompt_effective(
            template_name,
            project_id=project_id,
            override_store=self._override_store,
            global_override_store=self._global_override_store,
            prompts_dir=self.prompts_dir,
        )
        # Negative-constraints injection: render the user's block (or strip
        # the placeholder cleanly when empty), then expose it as a kwarg
        # PromptTemplate.format_system substitutes into {negative_constraints}.
        from backend.services.prompt_override_store import render_negative_block

        nc_raw = str(data.get("negative_constraints", "") or "")
        rendered = render_negative_block(nc_raw)
        system_prompt = str(data.get("system_prompt", "") or "")
        if not rendered:
            system_prompt = system_prompt.replace("{negative_constraints}", "").rstrip() + "\n"
        data = {
            **data,
            "system_prompt": system_prompt,
            "negative_constraints": rendered,
        }
        return PromptTemplate(data)
```

- [ ] **Step 4: 运行测试，确认通过**

```bash
source venv/bin/activate && pytest tests/test_negative_constraints.py -v
```
Expected: 8 passed (4 from T1 + 4 new). 跑一下邻近测试确认没回归：

```bash
source venv/bin/activate && pytest tests/test_load_prompt_with_override.py tests/test_load_prompt_runtime_e2e.py tests/test_prompt_override_store.py -v
```
Expected: all pass.

- [ ] **Step 5: 提交**

```bash
git add backend/agents/base_agent.py tests/test_negative_constraints.py
git commit -m "feat(prompts): inject negative_constraints into system prompt in load_prompt"
```

---

## Task 3: Per-project API payload 增加 `negative_constraints`

**Files:**
- Modify: `backend/api/prompt_plaza.py:26-35`
- Modify: `tests/test_prompt_plaza_api.py`（追加一个测试） OR 新建 `tests/test_negative_constraints_api.py`

- [ ] **Step 1: 写失败 API 测试**

追加到 `tests/test_prompt_plaza_api.py`（已存在的测试文件，按既有 `TestClient` 写法）：

```python
def test_plaza_accepts_negative_constraints_on_put(tmp_path, monkeypatch):
    """PUT /api/projects/{id}/prompts/scene_writing accepts the new field."""
    from fastapi.testclient import TestClient
    from backend.api.prompt_plaza import router
    from backend.config import settings

    prompts_dir = tmp_path / "prompts"
    prompts_dir.mkdir()
    (prompts_dir / "scene_writing.yaml").write_text(yaml.safe_dump({
        "system_prompt": "sys", "user_prompt_template": "user",
        "temperature": 0.5, "max_tokens": 100,
    }))
    projects_dir = tmp_path / "projects" / "proj_x"
    projects_dir.mkdir(parents=True)
    monkeypatch.setattr(settings, "projects_dir", tmp_path / "projects")
    monkeypatch.setattr(settings, "prompts_dir", prompts_dir)

    from backend.main import app
    client = TestClient(app)
    resp = client.put(
        "/api/projects/proj_x/prompts/scene_writing",
        json={
            "system_prompt": "sys",
            "user_prompt_template": "user",
            "temperature": 0.5,
            "max_tokens": 100,
            "negative_constraints": "不要使用回合制战斗描写\n不要出现现代品牌名",
        },
    )
    assert resp.status_code == 200, resp.text
    body = resp.json()
    assert body["error"] is False
    saved = body["detail"]["override"]
    assert saved["negative_constraints"] == (
        "不要使用回合制战斗描写\n不要出现现代品牌名"
    )
```

确认 import 顶部已经 `import yaml`（如果没，加 `import yaml`）。如果 `test_prompt_plaza_api.py` 没有 `TestClient`/`app` 现有 fixture，按下文用 monkeypatch 直接造一个最小架子。

- [ ] **Step 2: 运行测试，确认失败**

```bash
source venv/bin/activate && pytest tests/test_prompt_plaza_api.py -k negative_constraints -v
```
Expected: FAIL — Pydantic 应该返回 422（`extra="forbid"`），或保存时不包含 `negative_constraints`。

- [ ] **Step 3: 添加字段**

打开 `backend/api/prompt_plaza.py`，修改 `PromptOverridePayload` 类（26-35 行）：

```python
class PromptOverridePayload(BaseModel):
    """Fields a user can override. extra='forbid' rejects _modified_at etc."""

    system_prompt: Optional[str] = None
    user_prompt_template: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    output_format: Optional[Dict[str, Any]] = None
    negative_constraints: Optional[str] = None  # ← 新增

    model_config = ConfigDict(extra="forbid")
```

- [ ] **Step 4: 运行测试 + 邻近回归**

```bash
source venv/bin/activate && pytest tests/test_prompt_plaza_api.py tests/test_prompt_override_store.py -v
```
Expected: all pass.

- [ ] **Step 5: 提交**

```bash
git add backend/api/prompt_plaza.py tests/test_prompt_plaza_api.py
git commit -m "feat(prompts): per-project plaza accepts negative_constraints field"
```

---

## Task 4: Global API payload 增加 `negative_constraints`

**Files:**
- Modify: `backend/api/prompt_defaults.py:30-39`
- Modify: `tests/test_prompt_defaults_api.py`（追加一个测试）

- [ ] **Step 1: 写失败 API 测试**

追加到 `tests/test_prompt_defaults_api.py`：

```python
def test_default_accepts_negative_constraints_on_put(tmp_path, monkeypatch):
    """PUT /api/prompts/defaults/scene_writing accepts the new field."""
    from fastapi.testclient import TestClient
    from backend.config import settings

    prompts_dir = tmp_path / "prompts"
    prompts_dir.mkdir()
    (prompts_dir / "scene_writing.yaml").write_text(yaml.safe_dump({
        "system_prompt": "sys", "user_prompt_template": "user",
    }))
    global_path = tmp_path / "config" / "global_prompt_overrides.json"
    monkeypatch.setattr(
        settings, "global_prompt_overrides_path", global_path
    )
    monkeypatch.setattr(settings, "prompts_dir", prompts_dir)

    from backend.main import app
    client = TestClient(app)
    resp = client.put(
        "/api/prompts/defaults/scene_writing",
        json={
            "system_prompt": "sys",
            "user_prompt_template": "user",
            "negative_constraints": "不要出现本章完",
        },
    )
    assert resp.status_code == 200, resp.text
    saved = resp.json()["detail"]["override"]
    assert saved["negative_constraints"] == "不要出现本章完"
```

顶部 `import yaml`（如缺）。

- [ ] **Step 2: 运行测试，确认失败**

```bash
source venv/bin/activate && pytest tests/test_prompt_defaults_api.py -k negative_constraints -v
```
Expected: 422 / 字段未保存。

- [ ] **Step 3: 添加字段**

打开 `backend/api/prompt_defaults.py`，修改 `PromptOverridePayload`（30-39 行）：

```python
class PromptOverridePayload(BaseModel):
    """Fields a user can override. extra='forbid' rejects _modified_at etc."""

    system_prompt: Optional[str] = None
    user_prompt_template: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    output_format: Optional[Dict[str, Any]] = None
    negative_constraints: Optional[str] = None  # ← 新增

    model_config = ConfigDict(extra="forbid")
```

- [ ] **Step 4: 运行 + 邻近回归**

```bash
source venv/bin/activate && pytest tests/test_prompt_defaults_api.py tests/test_global_prompt_override_store.py -v
```
Expected: all pass.

- [ ] **Step 5: 提交**

```bash
git add backend/api/prompt_defaults.py tests/test_prompt_defaults_api.py
git commit -m "feat(prompts): global defaults api accepts negative_constraints field"
```

---

## Task 5: 迁移 `scene_writing.yaml`（canonical example）

**Files:**
- Modify: `backend/prompts/scene_writing.yaml`

这是最高频使用的 prompt，作为迁移首个示例。验证 T2 的 e2e 思路对真实 YAML 也成立。

- [ ] **Step 1: 备份当前文件，记下末尾几行**

```bash
tail -10 backend/prompts/scene_writing.yaml
```

记下当前 `system_prompt` 末尾几行（用作占位符插入参考位置）。

- [ ] **Step 2: 加 `negative_constraints: ""` 默认字段**

用编辑器打开 `backend/prompts/scene_writing.yaml`，**在 `max_tokens: 8192` 之后**（在 `system_prompt` 之前）插入：

```yaml
negative_constraints: ""
```

确认 YAML 顶层结构未变（缩进 0 空格）。

- [ ] **Step 3: 在 `system_prompt` 末尾加 `{negative_constraints}` 占位符**

scene_writing 的 system_prompt 结尾通常以 SF_LOG 兜底指令收尾。**不要**插在 SF_LOG 兜底指令之后。

定位到 `system_prompt` 块的最后一行「兜底之前」，把 `{negative_constraints}` 单独插一行。建议位置：在「知识泄漏禁止」段之后、SF_LOG 类型清单之前那一段。

示例插入位置（仅供参考，按实际 YAML 内容调整）：

```yaml
  2. 角色不能知道 "未知信息" 中列出的内容（知识泄漏禁止）
  {negative_constraints}
  3. 使用力量体系时不能超过设定的上限
```

> 如果末尾附近没有合适的「前置 hook」，可把 `{negative_constraints}` 直接插在 `system_prompt:` 块的最后一行之前。原则：避免被任何紧贴 SF_LOG 强制输出的兜底语句「挤出」末尾。

- [ ] **Step 4: 跑现有 scene_writing 相关测试**

```bash
source venv/bin/activate && pytest tests/ -k "scene_writing or scene_rewrite or load_prompt_runtime" -v
```
Expected: all pass. 若失败，多半是 YAML 格式错误：`python -c "import yaml; yaml.safe_load(open('backend/prompts/scene_writing.yaml'))"`。

- [ ] **Step 5: 验证 T2 e2e 在真实 YAML 上仍成立**

为防止 YAML 改错导致 system_prompt 模板断裂，写一个一次性验证脚本：

```bash
source venv/bin/activate && python -c "
from backend.agents.base_agent import BaseAgent
from backend.config import settings
p = settings.prompts_dir / 'scene_writing.yaml'
assert '{negative_constraints}' in p.read_text(), 'placeholder missing'
agent = BaseAgent(project_id='_smoke', prompts_dir=settings.prompts_dir)
tmpl = agent.load_prompt('scene_writing')
print('placeholder in YAML:', '{negative_constraints}' in p.read_text())
print('rendered no-override system length:', len(tmpl.system_prompt))
print('placeholder still present in tmpl:', '{negative_constraints}' in tmpl.system_prompt)
"
```
Expected: 第一/三个 True，第二个 ≥ 既有长度（占位符被 strip 时引入的 newline 不应让长度变多几十个字节以上）。

- [ ] **Step 6: 提交**

```bash
git add backend/prompts/scene_writing.yaml
git commit -m "chore(prompts): add negative_constraints placeholder to scene_writing.yaml"
```

---

## Task 6: 迁移所有 root-level YAML（除 scene_writing）

**Files:**
- Modify: `backend/prompts/{branch_simulation_llm,canvas_to_concept,chapter_summary,character_generation,concept_generation,narrative_guard,novel_outline_generation,outline_generation,scene_rewrite,semantic_precheck,sf_log_suggestion,world_generation,world_power_system_rewrite}.yaml`

13 个 root-level YAML。每个文件做两件事：
1. 顶层加 `negative_constraints: ""`（在 `max_tokens` 之后或在 `system_prompt` 之前）
2. `system_prompt` 末尾加 `{negative_constraints}`（默认放最末行兜底之前；如果该 YAML system_prompt 极短如 `narrative_guard`，亦可放 `system_prompt:` 块的最后一行）

- [ ] **Step 1: 列出待迁移文件清单**

```bash
ls backend/prompts/*.yaml | grep -v scene_writing.yaml
```
确认是 13 个。

- [ ] **Step 2: 逐文件改**

打开 `backend/prompts/branch_simulation_llm.yaml`：
1. 在 `max_tokens:`（或任何顶层标量字段）后插入 `negative_constraints: ""`
2. `system_prompt:` 块末尾加一行 `{negative_constraints}`

剩余 12 个 YAML 同样操作。**每个文件单独保存**，不要多文件批量改。

- [ ] **Step 3: YAML 格式校验**

```bash
for f in backend/prompts/*.yaml; do python -c "import yaml; yaml.safe_load(open('$f'))" || echo "BAD: $f"; done
```
Expected: 没有 `BAD: ...` 输出。

- [ ] **Step 4: 跑回归**

```bash
source venv/bin/activate && pytest tests/test_negative_constraints.py tests/test_load_prompt_with_override.py -v
```
Expected: all pass。

- [ ] **Step 5: 提交**

```bash
git add backend/prompts/*.yaml
git commit -m "chore(prompts): add negative_constraints placeholder to remaining root prompts"
```

---

## Task 7: 迁移 `character_designer/*.yaml`

**Files:**
- Modify: `backend/prompts/character_designer/growth_discuss.yaml`

- [ ] **Step 1: 改文件**

同 T6 的两步规则：顶层 `negative_constraints: ""` + `system_prompt` 末尾 `{negative_constraints}`。

- [ ] **Step 2: YAML 校验**

```bash
python -c "import yaml; yaml.safe_load(open('backend/prompts/character_designer/growth_discuss.yaml'))"
```
Expected: 无输出（成功）。

- [ ] **Step 3: 提交**

```bash
git add backend/prompts/character_designer/growth_discuss.yaml
git commit -m "chore(prompts): add negative_constraints placeholder to character_designer/growth_discuss"
```

---

## Task 8: 迁移 `creative/*.yaml`（9 个文件）

**Files:**
- Modify:
  - `backend/prompts/creative/contradiction_expand.yaml`
  - `backend/prompts/creative/creative_director_direction.yaml`
  - `backend/prompts/creative/creative_director_mutation.yaml`
  - `backend/prompts/creative/creative_director_path.yaml`
  - `backend/prompts/creative/genre_fusion.yaml`
  - `backend/prompts/creative/mutation_operation.yaml`
  - `backend/prompts/creative/novelty_evaluation_llm.yaml`
  - `backend/prompts/creative/trope_extraction.yaml`
  - `backend/prompts/creative/whatif_expand.yaml`

- [ ] **Step 1: 列出文件清单**

```bash
ls backend/prompts/creative/*.yaml
```
确认 9 个文件。

- [ ] **Step 2: 逐文件改**

每个文件：顶层加 `negative_constraints: ""` + `system_prompt` 末尾 `{negative_constraints}`。

- [ ] **Step 3: 批量 YAML 校验**

```bash
for f in backend/prompts/creative/*.yaml; do python -c "import yaml; yaml.safe_load(open('$f'))" || echo "BAD: $f"; done
```
Expected: 无输出。

- [ ] **Step 4: 提交**

```bash
git add backend/prompts/creative/*.yaml
git commit -m "chore(prompts): add negative_constraints placeholder to creative/* prompts"
```

---

## Task 9: 迁移 `style_engine/*.yaml`

**Files:**
- Modify: `backend/prompts/style_engine/sandbox_preview.yaml`

- [ ] **Step 1: 改文件**

两步规则：顶层 `negative_constraints: ""` + `system_prompt` 末尾 `{negative_constraints}`。

- [ ] **Step 2: YAML 校验**

```bash
python -c "import yaml; yaml.safe_load(open('backend/prompts/style_engine/sandbox_preview.yaml'))"
```

- [ ] **Step 3: 提交**

```bash
git add backend/prompts/style_engine/sandbox_preview.yaml
git commit -m "chore(prompts): add negative_constraints placeholder to style_engine/sandbox_preview"
```

---

## Task 10: 前端类型 + API client

**Files:**
- Modify: `frontend/src/api/promptPlaza.ts:23-29`

- [ ] **Step 1: 改 `PromptOverridePayload` interface**

打开 `frontend/src/api/promptPlaza.ts`，把 23-29 行：

```ts
export interface PromptOverridePayload {
  system_prompt?: string;
  user_prompt_template?: string;
  temperature?: number;
  max_tokens?: number;
  output_format?: Record<string, unknown>;
}
```

改成：

```ts
export interface PromptOverridePayload {
  system_prompt?: string;
  user_prompt_template?: string;
  temperature?: number;
  max_tokens?: number;
  output_format?: Record<string, unknown>;
  negative_constraints?: string;
}
```

`PromptSummary` 和 `PromptDetail` 不需要改：前者字段都来自后端 list 接口（不需要包含 negative_constraints），后者的 `effective` 已经是 `Record<string, unknown>`，会自动包含新字段（前端读 `detail.effective["negative_constraints"]` 时类型是 `unknown`，需要 cast）。

- [ ] **Step 2: 类型检查**

```bash
cd frontend && npm run -s typecheck 2>/dev/null || npx tsc --noEmit -p tsconfig.json
```
Expected: 无 type error。

- [ ] **Step 3: 提交**

```bash
git add frontend/src/api/promptPlaza.ts
git commit -m "feat(plaza): PromptOverridePayload accepts negative_constraints"
```

---

## Task 11: PromptEditPanel 新增负面清单区块 + vitest

**Files:**
- Modify: `frontend/src/components/home/promptPlaza/PromptEditPanel.tsx`
- Create: `frontend/src/test/promptPlaza/PromptEditPanel.test.tsx`

- [ ] **Step 1: 写失败 vitest**

新建 `frontend/src/test/promptPlaza/PromptEditPanel.test.tsx`：

```tsx
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import PromptEditPanel from "../../components/home/promptPlaza/PromptEditPanel";

function makeDetail(extra: Record<string, unknown> = {}) {
  return {
    name: "scene_writing",
    builtin_yaml: {},
    override: null,
    effective: {
      system_prompt: "DEFAULT",
      user_prompt_template: "u",
      temperature: 0.7,
      max_tokens: 1000,
      output_format: {},
      negative_constraints: "",
      ...extra,
    },
  };
}

describe("PromptEditPanel negative_constraints", () => {
  it("renders negative_constraints textarea", () => {
    const onSave = vi.fn();
    render(
      <PromptEditPanel
        detail={makeDetail()}
        loading={false}
        error={null}
        onSave={onSave}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const ta = screen.getByTestId("edit-negative-constraints");
    expect(ta).toBeInTheDocument();
    expect(ta.tagName).toBe("TEXTAREA");
  });

  it("includes negative_constraints in save payload when dirty", () => {
    const onSave = vi.fn();
    render(
      <PromptEditPanel
        detail={makeDetail({ negative_constraints: "OLD RULE" })}
        loading={false}
        error={null}
        onSave={onSave}
        onReset={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    const ta = screen.getByTestId("edit-negative-constraints");
    fireEvent.change(ta, { target: { value: "新规则" } });
    fireEvent.click(screen.getByTestId("save-button"));
    expect(onSave).toHaveBeenCalledWith(
      expect.objectContaining({ negative_constraints: "新规则" }),
    );
  });

  it("clears negative_constraints on reset", () => {
    const onReset = vi.fn();
    render(
      <PromptEditPanel
        detail={makeDetail({ negative_constraints: "BASELINE" })}
        loading={false}
        error={null}
        onSave={vi.fn()}
        onReset={onReset}
        onClose={vi.fn()}
      />,
    );
    fireEvent.change(
      screen.getByTestId("edit-negative-constraints"),
      { target: { value: "DIRTY EDIT" } },
    );
    fireEvent.click(screen.getByTestId("reset-button"));
    expect(onReset).toHaveBeenCalled();
    // after reset, textarea reverts to baseline via useEffect on parent.
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

```bash
cd frontend && npm test -- --run PromptEditPanel.test
```
Expected: 3 failed — `data-testid="edit-negative-constraints"` not found / save 没带上 `negative_constraints`。

- [ ] **Step 3: 改 `PromptEditPanel.tsx`**

打开 `frontend/src/components/home/promptPlaza/PromptEditPanel.tsx`。

修改 1 — 顶部 `Props.onSave` 类型扩字段（10-16 行）：

```ts
  onSave: (payload: {
    system_prompt?: string;
    user_prompt_template?: string;
    temperature?: number;
    max_tokens?: number;
    output_format?: Record<string, unknown>;
    negative_constraints?: string;
  }) => void;
```

修改 2 — 增加 `getEffectiveString` 的 helper 调用 + state：

在现有 useState 列表（32-36 行）后追加：

```tsx
  const [negativeConstraints, setNegativeConstraints] = useState("");
  const negRef = useRef<HTMLTextAreaElement>(null);
  useAutoHeight(negRef, [negativeConstraints]);
```

修改 3 — `useEffect` 里 init `negativeConstraints`：

```tsx
    setNegativeConstraints(getEffectiveString(detail, "negative_constraints"));
```

修改 4 — `dirty` 计算里加入新字段：

```tsx
    const baseNc = getEffectiveString(detail, "negative_constraints");
    // ... existing diff ...
    return (
      systemPrompt !== baseSystem ||
      userTemplate !== baseUser ||
      temperature !== baseTemp ||
      maxTokens !== baseMax ||
      outputFormatJson !== baseOf ||
      negativeConstraints !== baseNc
    );
```

修改 5 — `handleSave` 里加上新字段：

```tsx
    onSave({
      system_prompt: systemPrompt,
      user_prompt_template: userTemplate,
      temperature,
      max_tokens: maxTokens,
      output_format: parsed,
      negative_constraints: negativeConstraints,
    });
```

修改 6 — 在 `<AdvancedSection>` 之前（158 行那块），新增区块：

```tsx
        <div>
          <label className="block text-xs font-label-mono text-system-log mb-1">
            负面清单 / 禁止事项
            <span className="ml-2 text-system-log/60">
              {negativeConstraints.length} 字
              {negativeConstraints.length > 1500 && (
                <span className="ml-2 text-error" data-testid="nc-warn">
                  该清单预计 ~{Math.round(negativeConstraints.length * 1.5)} tokens，超过 1500 字符可能挤占提示词上下文预算
                </span>
              )}
            </span>
          </label>
          <textarea
            ref={negRef}
            value={negativeConstraints}
            onChange={(e) => setNegativeConstraints(e.target.value)}
            placeholder="一行一条规则。例：不要使用回合制战斗描写"
            data-testid="edit-negative-constraints"
            className="w-full bg-surface-container border border-outline-variant rounded px-3 py-2 text-sm font-mono overflow-hidden"
            style={{ resize: "none" }}
          />
          <p className="mt-1 text-xs text-system-log/70">
            会作为【禁止事项】区块注入到系统提示词的占位符位置；空则不注入。
          </p>
        </div>
```

- [ ] **Step 4: 运行 + 邻近 vitest 回归**

```bash
cd frontend && npm test -- --run
```
Expected: all pass. 重点关注 `PromptPlazaModal.test.tsx` 因为它 stub 了 PromptEditPanel — 如果新增 export 或破坏 API，stub 仍 OK（不会报错）。

- [ ] **Step 5: 提交**

```bash
git add frontend/src/components/home/promptPlaza/PromptEditPanel.tsx frontend/src/test/promptPlaza/PromptEditPanel.test.tsx
git commit -m "feat(plaza): PromptEditPanel adds 负面清单 section with char count + soft cap warning"
```

---

## Task 12: 端到端手测（不自动化）

**Files:** 不动代码。

- [ ] **Step 1: 启动后端 + 前端**

```bash
# 终端 A
source venv/bin/activate && uvicorn backend.main:app --reload --port 8000

# 终端 B
cd frontend && npm run dev
```

打开 http://localhost:5173。

- [ ] **Step 2: 全局默认负面清单**

1. 顶部点「AI 工具 → 提示词广场」（无项目上下文时改 HomePage 侧栏的入口）
2. 选 `scene_writing`，在「负面清单」写两条规则，保存
3. 重启 Home page，确认清单还在（全局生效）

- [ ] **Step 3: 项目级覆盖**

1. 进任一项目 → Workspace → 顶栏 AI 工具 → 提示词广场
2. 选 `outline_generation`，写 1 条负面清单 → 保存
3. 该清单应**只**在该项目可见

- [ ] **Step 4: 实际写作验证**

1. 选 `scene_writing`，写「不要出现回合制战斗描写」
2. 在项目里跑一章 / 重生某章节
3. 检查输出正文不命中规则（人工 grep 「回合」/「你先出招」之类关键词）

- [ ] **Step 5: reset / 边界**

1. 写一段全空白的清单「   」→ 保存 → 回看 → 应被 trim 为空
2. 写一行但故意字数 > 1500 → UI 应显示 token 估算警告
3. Reset 按钮 → 字段回到 YAML 默认

- [ ] **Step 6: 跑完整测试套件**

```bash
source venv/bin/activate && pytest tests/ -q
cd frontend && npm test -- --run
```
Expected: all pass。

- [ ] **Step 7: 在 PR 描述里记录**

PR 描述里附 §四 端到端手测 5 条勾选结果 + 全套测试通过截图。

---

## 自审

已完成以下自审：

- **Spec coverage：** §三 数据模型 → T1/T2；§三 渲染 + 空值 → T2；§四 YAML 迁移 → T5-T9；§五 API+前端 → T3/T4/T10/T11；§六 测试覆盖 → T1/T2（render / merge / e2e）+ T3/T4（API）+ T11（vitest）+ T12（手测）。无 spec gap。
- **Placeholder scan：** 无 "TBD" / "类似 Task N" / 模糊描述。
- **Type consistency：** `render_negative_block` (T1) → `BaseAgent.load_prompt` 引用 (T2) → 接口 (T5/T6 e2e)；`negative_constraints` (T3/T4 payload) → `PromptOverridePayload.negative_constraints?` (T10) → `onSave` payload (T11)。
- **Task granularity：** 每任务 2-5 分钟，最多 1 个 YAML batch。
- **Order：** T1 (helper) → T2 (agent wiring + e2e) → T3/T4 (API) → T5 (1 canonical yaml) → T6-T9 (其余 yaml) → T10 (TS types) → T11 (UI) → T12 (smoke)。
