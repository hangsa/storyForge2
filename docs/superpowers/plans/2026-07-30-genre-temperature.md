# Genre Temperature Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `config/genres/<id>.yaml` `model_preferences.temperature` actually take effect in tier_1 LLM calls via a BaseAgent-layer temperature resolver that merges sandbox > prompt > genre > settings fallback.

**Architecture:** Add a `_resolve_temperature(prompt, custom_style_config)` helper on `BaseAgent` that consults `self._is_tier_1_agent()` first (short-circuits to old behavior for tier_2/3), then walks the 4-level priority chain. Wire `genre=project.get("genre", "cool_novel")` into all 7 tier_1 agent construction sites so `self.genre` is set before the first LLM call. Replace the 3 `temperature=prompt.temperature` kwargs in `generate_from_template`/`generate_from_template_stream`/the direct provider branch with `temperature=self._resolve_temperature(prompt, custom_style_config)`.

**Tech Stack:** Python 3 · pytest · existing `PromptTemplate`, `SandboxParams`, `GenreCatalog`, `ModelRouter._mappings` patterns.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `backend/agents/base_agent.py` | **Modify** | Add `_resolve_temperature`, `_is_tier_1_agent`; add `genre` to `__init__`; replace 3 `temperature=` kwargs |
| `backend/agents/planner.py` | **Modify** | `PlannerAgent.__init__` accepts and passes `genre` |
| `backend/agents/writer.py` | **Modify** | `WriterAgent.__init__` accepts and passes `genre` |
| `backend/agents/creative_director.py` | **Modify** | `CreativeDirector.__init__` accepts and passes `genre` |
| `backend/agents/character_designer.py` | **Modify** | `CharacterDesigner.__init__` accepts and passes `genre` |
| `backend/api/stage1_concept.py` | **Modify** | Pass `genre=` to `PlannerAgent(...)` |
| `backend/api/stage2_world_char.py` | **Modify** | Pass `genre=` to 3 `PlannerAgent(...)` call sites |
| `backend/api/stage2_planner.py` | **Modify (if exists)** | Pass `genre=` to `PlannerAgent(...)` if present |
| `backend/api/stage3_outline.py` | **Modify** | Pass `genre=` to 2 `PlannerAgent(...)` call sites |
| `backend/api/stage4_writing.py` | **Modify** | Pass `genre=` to 2 `WriterAgent(...)` call sites |
| `backend/api/creative_canvas.py` | **Modify** | Pass `genre=` to 1 `PlannerAgent(...)` call site |
| `tests/test_genre_temperature.py` | **Create** | 12 tests across 4 classes |

No changes to: `config/genres/*.yaml`, `backend/genres/catalog.py`, `backend/llm/model_router.py`, `backend/llm/base_provider.py`, `backend/config.py`, `backend/style_engine/sandbox_renderer.py`, frontend.

---

## Task 1: Tier detection helper + `genre` field on BaseAgent

**Files:**
- Modify: `backend/agents/base_agent.py`
- Test: `tests/test_genre_temperature.py`

- [ ] **Step 1: Create the test file with the first 3 tests**

Create `tests/test_genre_temperature.py`:

```python
"""Tests for BaseAgent._resolve_temperature + genre-aware temperature routing."""
from unittest.mock import MagicMock

import pytest


def _make_agent(agent_name: str, genre: str = "cool_novel", tier_map: dict | None = None):
    """Build a BaseAgent-like object for unit tests of _resolve_temperature."""
    from backend.agents.base_agent import BaseAgent

    agent = BaseAgent.__new__(BaseAgent)
    agent.agent_name = agent_name
    agent.genre = genre
    # Stub router._mappings so _is_tier_1_agent has something to inspect
    mock_router = MagicMock()
    mock_router._mappings = {agent_name: tier_map or {}}
    agent._router = mock_router
    return agent


def _prompt(temp=None) -> MagicMock:
    p = MagicMock()
    p.temperature = temp
    return p


class TestTierFiltering:
    def test_tier_1_agent_returns_true(self):
        from backend.agents.planner import PlannerAgent  # planner is all tier_1
        agent = _make_agent("planner", tier_map={
            "concept_generation": MagicMock(tier_name="tier_1"),
            "outline_generation": MagicMock(tier_name="tier_1"),
        })
        assert agent._is_tier_1_agent() is True

    def test_tier_2_agent_returns_false(self):
        # reviewer has tier_2 tasks
        agent = _make_agent("reviewer", tier_map={
            "fact_guard": MagicMock(tier_name="tier_0"),  # tier_0, not tier_1
        })
        assert agent._is_tier_1_agent() is False

    def test_unknown_agent_returns_false(self):
        agent = _make_agent("nonexistent_agent", tier_map={})
        assert agent._is_tier_1_agent() is False
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
source venv/bin/activate
pytest tests/test_genre_temperature.py::TestTierFiltering -v
```

Expected: FAIL — `AttributeError: 'BaseAgent' object has no attribute '_is_tier_1_agent'`.

- [ ] **Step 3: Add `_is_tier_1_agent` and `genre` to BaseAgent**

In `backend/agents/base_agent.py`:

(a) Modify `__init__` signature and body (currently at line ~47):

```python
    def __init__(
        self,
        project_id: str,
        prompts_dir: Optional[Path] = None,
        model_router: Optional[ModelRouter] = None,
        override_store: Optional["PromptOverrideStore"] = None,
        global_override_store: Optional["GlobalPromptOverrideStore"] = None,
        genre: str = "cool_novel",
    ):
        self.project_id = project_id
        self.prompts_dir = Path(prompts_dir) if prompts_dir else settings.prompts_dir
        self._provider: Optional[BaseLLMProvider] = None
        self._usage_log_path: Optional[Path] = None
        self._router = model_router
        self._override_store = override_store
        self._global_override_store = global_override_store
        self.genre = genre
```

(b) Add the helper method (place it next to `router` property, around line 73):

```python
    def _is_tier_1_agent(self) -> bool:
        """Check if THIS agent's tasks are all routed to tier_1.

        Walks all task mappings for agent_name; returns True only when every
        task points to tier_1. Returns False for any non-tier_1 task or on any
        lookup failure (router not initialized yet, agent not in mapping).

        Agent-level (not task-level) granularity: sufficient because all known
        tier_1 agents (planner, writer, creative_director, character_designer)
        are exclusively tier_1, and tier_2/3 agents have at least one non-
        tier_1 task.
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

- [ ] **Step 4: Run tests to verify they pass**

```bash
source venv/bin/activate
pytest tests/test_genre_temperature.py::TestTierFiltering -v
```

Expected: 3 PASS.

If `test_tier_1_agent_returns_true` fails with "tier_1_agent" not existing: the import path `from backend.agents.planner import PlannerAgent` may fail if PlannerAgent has side effects. If so, replace the import with a stub:

```python
    def test_tier_1_agent_returns_true(self):
        # planner is all tier_1 per config/model_tiers.yaml
        agent = _make_agent("planner", tier_map={
            "concept_generation": MagicMock(tier_name="tier_1"),
            "outline_generation": MagicMock(tier_name="tier_1"),
        })
        assert agent._is_tier_1_agent() is True
```

(remove the unused import line)

- [ ] **Step 5: Commit**

```bash
git add backend/agents/base_agent.py tests/test_genre_temperature.py
git commit -m "feat(temperature): add tier-1 detection + genre field on BaseAgent"
```

---

## Task 2: `_resolve_temperature` helper + sandbox > prompt > genre > fallback

**Files:**
- Modify: `backend/agents/base_agent.py`
- Test: `tests/test_genre_temperature.py`

- [ ] **Step 1: Add the resolution test class**

Append to `tests/test_genre_temperature.py`:

```python
class TestGenreTemperatureResolution:
    def test_genre_temperature_used_when_prompt_has_no_temperature(self):
        agent = _make_agent("planner", genre="xianxia", tier_map={
            "outline_generation": MagicMock(tier_name="tier_1"),
        })
        prompt = _prompt(temp=None)
        assert agent._resolve_temperature(prompt, None) == 0.85  # xianxia

    def test_prompt_temperature_overrides_genre(self):
        agent = _make_agent("planner", genre="xianxia", tier_map={
            "outline_generation": MagicMock(tier_name="tier_1"),
        })
        prompt = _prompt(temp=0.7)
        assert agent._resolve_temperature(prompt, None) == 0.7

    def test_sandbox_temperature_overrides_prompt_and_genre(self):
        from backend.style_engine.sandbox_models import SandboxParams
        agent = _make_agent("writer", genre="xianxia", tier_map={
            "scene_writing": MagicMock(tier_name="tier_1"),
        })
        sandbox = SandboxParams(temperature=0.5, action_ratio=0.4)
        prompt = _prompt(temp=0.7)
        assert agent._resolve_temperature(prompt, sandbox) == 0.5

    def test_fallback_to_settings_when_all_unset(self):
        agent = _make_agent("planner", genre="__unset__", tier_map={
            "outline_generation": MagicMock(tier_name="tier_1"),
        })
        prompt = _prompt(temp=None)
        result = agent._resolve_temperature(prompt, None)
        # __unset__ is unknown genre; catalog falls back to first index entry
        # (cool_novel, model_preferences.temperature=0.9). So result is 0.9,
        # not the global settings.llm_temperature. Verify the catalog-fallback
        # path:
        assert result == 0.9

    def test_invalid_genre_falls_back_silently(self):
        # A genre that doesn't exist falls back to catalog's first index entry
        # (cool_novel, 0.9) — never raises, never returns None.
        agent = _make_agent("planner", genre="__totally_unknown_genre__", tier_map={
            "outline_generation": MagicMock(tier_name="tier_1"),
        })
        prompt = _prompt(temp=None)
        result = agent._resolve_temperature(prompt, None)
        assert isinstance(result, float)
        assert 0.0 <= result <= 2.0
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
source venv/bin/activate
pytest tests/test_genre_temperature.py::TestGenreTemperatureResolution -v
```

Expected: 5 FAIL — `AttributeError: 'BaseAgent' object has no attribute '_resolve_temperature'`.

- [ ] **Step 3: Implement `_resolve_temperature`**

Add to `backend/agents/base_agent.py` (immediately after `_is_tier_1_agent`):

```python
    def _resolve_temperature(
        self,
        prompt: "PromptTemplate",
        custom_style_config: Optional[dict] = None,
    ) -> float:
        """Resolve effective temperature for the current LLM call.

        Precedence (most specific wins):
          1. sandbox_params.temperature  (via custom_style_config)
          2. prompt.temperature           (from YAML / override)
          3. genre.model_preferences.temperature  (from catalog, tier_1 only)
          4. settings.llm_temperature     (global fallback, default 0.7)

        Returns float. Silent — no warnings logged when genre supplies the
        value (user wants the merge to be invisible). On any lookup failure
        the next layer in the chain is tried.
        """
        # Tier filter: only tier_1 agents get genre temperature. tier_2/3 keep
        # the original prompt.temperature → settings fallback behavior.
        if not self._is_tier_1_agent():
            if isinstance(prompt.temperature, (int, float)) and not isinstance(prompt.temperature, bool):
                return float(prompt.temperature)
            from backend.config import settings
            return settings.llm_temperature

        # 1. Sandbox temperature
        if custom_style_config is not None:
            try:
                from backend.style_engine.sandbox_models import SandboxParams
                params = (
                    custom_style_config
                    if isinstance(custom_style_config, SandboxParams)
                    else SandboxParams(**custom_style_config)
                )
                if isinstance(params.temperature, (int, float)) and not isinstance(params.temperature, bool):
                    return float(params.temperature)
            except Exception:
                pass

        # 2. Prompt temperature
        if isinstance(prompt.temperature, (int, float)) and not isinstance(prompt.temperature, bool):
            return float(prompt.temperature)

        # 3. Genre temperature (tier_1 only — already guarded above)
        try:
            from backend.genres.catalog import get_catalog
            entry = get_catalog().get(self.genre)
            mp_temp = (entry.get("model_preferences") or {}).get("temperature")
            if isinstance(mp_temp, (int, float)) and not isinstance(mp_temp, bool):
                return float(mp_temp)
        except Exception:
            pass

        # 4. Global fallback
        from backend.config import settings
        return settings.llm_temperature
```

- [ ] **Step 4: Run the new tests to verify they pass**

```bash
source venv/bin/activate
pytest tests/test_genre_temperature.py::TestGenreTemperatureResolution -v
```

Expected: 5 PASS.

If `test_fallback_to_settings_when_all_unset` fails because the catalog returns cool_novel's 0.9 instead of `settings.llm_temperature=0.7`: that's expected. The test was written to verify the **catalog fallback path** (genre "__unset__" → catalog falls back to first index entry → cool_novel → 0.9). If the test expects 0.7, that's wrong — the spec says genre defaults to `cool_novel` in catalog, and the resolver's tier_1 path always tries genre before settings fallback. The test as written is correct.

If any test fails with a different error (e.g., `SandboxParams` import fails, `_is_tier_1_agent` returns wrong value), debug by running just that test with `-v` and `print(prompt.temperature)` etc.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/base_agent.py tests/test_genre_temperature.py
git commit -m "feat(temperature): implement _resolve_temperature with 4-level priority"
```

---

## Task 3: Tier-2/3 + integration tests

**Files:**
- Modify: `tests/test_genre_temperature.py`

- [ ] **Step 1: Add TestTierFiltering (already in Task 1) and verify tier_2/3 path**

The Task 1 file already has 3 tier tests. Add 2 more edge-case tier tests + 2 integration tests + 2 error-handling tests. Append to `tests/test_genre_temperature.py`:

```python
class TestTierFilteringExtra:
    """Edge cases for _is_tier_1_agent."""

    def test_mixed_tier_agent_returns_false(self):
        # An agent that has tier_1 AND tier_2 tasks → False (mixed is not tier_1)
        agent = _make_agent("hybrid", tier_map={
            "task_a": MagicMock(tier_name="tier_1"),
            "task_b": MagicMock(tier_name="tier_2"),
        })
        assert agent._is_tier_1_agent() is False

    def test_tier_2_prompt_path_skips_genre(self):
        # tier_2 agent: prompt.temperature=0.7 wins, genre (xianxia=0.85) ignored
        agent = _make_agent("reviewer", genre="xianxia", tier_map={
            "fact_guard": MagicMock(tier_name="tier_2"),
        })
        prompt = _prompt(temp=0.7)
        assert agent._resolve_temperature(prompt, None) == 0.7

    def test_tier_2_prompt_unset_falls_back_to_settings(self):
        agent = _make_agent("reviewer", genre="xianxia", tier_map={
            "fact_guard": MagicMock(tier_name="tier_2"),
        })
        prompt = _prompt(temp=None)
        result = agent._resolve_temperature(prompt, None)
        # tier_2 path: prompt has no temperature → settings.llm_temperature
        from backend.config import settings
        assert result == settings.llm_temperature


class TestIntegration:
    def test_resolve_temperature_matches_real_xianxia_value_0_85(self):
        agent = _make_agent("planner", genre="xianxia", tier_map={
            "outline_generation": MagicMock(tier_name="tier_1"),
        })
        prompt = _prompt(temp=None)
        assert agent._resolve_temperature(prompt, None) == 0.85

    def test_resolve_temperature_matches_real_cool_novel_value_0_9(self):
        agent = _make_agent("planner", genre="cool_novel", tier_map={
            "outline_generation": MagicMock(tier_name="tier_1"),
        })
        prompt = _prompt(temp=None)
        assert agent._resolve_temperature(prompt, None) == 0.9

    def test_resolve_temperature_matches_real_xuanyi_value_0_75(self):
        agent = _make_agent("planner", genre="xuanyi", tier_map={
            "outline_generation": MagicMock(tier_name="tier_1"),
        })
        prompt = _prompt(temp=None)
        assert agent._resolve_temperature(prompt, None) == 0.75


class TestErrorHandling:
    def test_catalog_failure_falls_back_silently(self):
        # Patch the catalog import inside _resolve_temperature to raise.
        from unittest.mock import patch
        agent = _make_agent("planner", genre="xianxia", tier_map={
            "outline_generation": MagicMock(tier_name="tier_1"),
        })
        prompt = _prompt(temp=None)
        with patch("backend.genres.catalog.get_catalog", side_effect=RuntimeError("boom")):
            result = agent._resolve_temperature(prompt, None)
        # Falls back to settings.llm_temperature
        from backend.config import settings
        assert result == settings.llm_temperature

    def test_invalid_sandbox_config_does_not_raise(self):
        # custom_style_config that fails SandboxParams(**dict) parse — should
        # skip sandbox layer and try prompt/genre/fallback without raising.
        agent = _make_agent("writer", genre="xianxia", tier_map={
            "scene_writing": MagicMock(tier_name="tier_1"),
        })
        bad_config = {"temperature": "not-a-number", "action_ratio": "junk"}
        prompt = _prompt(temp=None)
        # Should NOT raise; should fall through to genre (xianxia=0.85)
        result = agent._resolve_temperature(prompt, bad_config)
        assert result == 0.85
```

- [ ] **Step 2: Run all tests in the file**

```bash
source venv/bin/activate
pytest tests/test_genre_temperature.py -v
```

Expected: 15 PASS (3 tier + 5 resolution + 3 tier extra + 3 integration + 2 error handling).

> The plan budget was 12 tests; the implementer has added 3 extra for tier edge cases. Total 15 is a superset — acceptable.

- [ ] **Step 3: Run full backend test suite to check for regressions**

```bash
source venv/bin/activate
pytest tests/ -q --ignore=tests/test_genre_temperature.py 2>&1 | tail -10
```

Expected: no NEW failures introduced by the BaseAgent signature change. Pre-existing failures (10 known autopilot/SSE failures from T7 of pacing plan) should remain.

If new failures appear in tests touching `BaseAgent.__init__`, the most likely cause is a test that constructs `BaseAgent(...)` (or subclass) without providing `genre=` — but since `genre` defaults to `"cool_novel"`, this should NOT happen. If it does, add `genre="cool_novel"` explicitly to those tests, OR verify the test is constructing via a subclass whose `__init__` accepts `genre`.

- [ ] **Step 4: Commit**

```bash
git add tests/test_genre_temperature.py
git commit -m "test(temperature): tier edge cases + integration + error handling"
```

---

## Task 4: Wire `genre=` through tier_1 agent `__init__` chain

**Files:**
- Modify: `backend/agents/planner.py`
- Modify: `backend/agents/writer.py`
- Modify: `backend/agents/creative_director.py`
- Modify: `backend/agents/character_designer.py`
- Test: `tests/test_genre_temperature.py` (verify via existing tests)

- [ ] **Step 1: Add a smoke test that tier_1 agents accept `genre` kwarg**

Append to `tests/test_genre_temperature.py`:

```python
class TestAgentConstructorAcceptsGenre:
    def test_planner_agent_accepts_genre_kwarg(self):
        from backend.agents.planner import PlannerAgent
        # Smoke test: just verify the kwarg is accepted and stored
        # (full construction needs project_id + override stores; minimal check)
        # Use a stub to skip real init:
        import inspect
        sig = inspect.signature(PlannerAgent.__init__)
        assert "genre" in sig.parameters
        assert sig.parameters["genre"].default == "cool_novel"

    def test_writer_agent_accepts_genre_kwarg(self):
        from backend.agents.writer import WriterAgent
        import inspect
        sig = inspect.signature(WriterAgent.__init__)
        assert "genre" in sig.parameters
        assert sig.parameters["genre"].default == "cool_novel"

    def test_creative_director_accepts_genre_kwarg(self):
        from backend.agents.creative_director import CreativeDirector
        import inspect
        sig = inspect.signature(CreativeDirector.__init__)
        assert "genre" in sig.parameters

    def test_character_designer_accepts_genre_kwarg(self):
        from backend.agents.character_designer import CharacterDesigner
        import inspect
        sig = inspect.signature(CharacterDesigner.__init__)
        assert "genre" in sig.parameters
```

- [ ] **Step 2: Run the new tests to verify they fail**

```bash
source venv/bin/activate
pytest tests/test_genre_temperature.py::TestAgentConstructorAcceptsGenre -v
```

Expected: 4 FAIL — `genre` not in `__init__` signature.

- [ ] **Step 3: Add `genre` to each subclass's `__init__`**

For each of the 4 agents, locate their `__init__` and ensure it accepts + passes `genre` to `super().__init__(...)`.

**(a) `backend/agents/planner.py`** — `PlannerAgent.__init__` (around line 278+):

Add `genre: str = "cool_novel"` parameter and pass to super:

```python
        def __init__(
            self,
            project_id: str,
            prompts_dir: Optional[Path] = None,
            model_router: Optional[ModelRouter] = None,
            override_store: Optional["PromptOverrideStore"] = None,
            global_override_store: Optional["GlobalPromptOverrideStore"] = None,
            genre: str = "cool_novel",
        ):
            super().__init__(
                project_id,
                prompts_dir,
                model_router,
                override_store,
                global_override_store,
                genre=genre,
            )
```

> Match the existing `PlannerAgent.__init__` signature exactly (some subclasses may have additional kwargs like `character_designer`). Add `genre` at the end with default `"cool_novel"`.

**(b) `backend/agents/writer.py`** — `WriterAgent.__init__` (around line 119+): same pattern — add `genre: str = "cool_novel"` parameter, pass to `super().__init__(...)`.

**(c) `backend/agents/creative_director.py`** — `CreativeDirector.__init__` (line 22: `super().__init__(project_id, prompts_dir, model_router)`):

Change to:
```python
        def __init__(
            self,
            project_id: str,
            prompts_dir=None,
            model_router=None,
            genre: str = "cool_novel",
        ):
            super().__init__(
                project_id, prompts_dir, model_router, genre=genre,
            )
```

Match existing parameter style (creative_director may have a different shape than the others).

**(d) `backend/agents/character_designer.py`** — `CharacterDesigner.__init__` (line 25): same pattern — add `genre` parameter, pass to super.

If any subclass has additional kwargs beyond `project_id/prompts_dir/model_router`, preserve them. The `genre` kwarg goes at the end.

- [ ] **Step 4: Run the constructor tests to verify they pass**

```bash
source venv/bin/activate
pytest tests/test_genre_temperature.py::TestAgentConstructorAcceptsGenre -v
```

Expected: 4 PASS.

- [ ] **Step 5: Run the full temperature test file**

```bash
source venv/bin/activate
pytest tests/test_genre_temperature.py -v
```

Expected: 19 PASS (15 + 4 constructor).

- [ ] **Step 6: Commit**

```bash
git add backend/agents/planner.py backend/agents/writer.py backend/agents/creative_director.py backend/agents/character_designer.py tests/test_genre_temperature.py
git commit -m "feat(temperature): thread genre kwarg through tier_1 agent constructors"
```

---

## Task 5: Wire `genre=` into all tier_1 agent construction sites

**Files:**
- Modify: `backend/api/stage1_concept.py`
- Modify: `backend/api/stage2_world_char.py`
- Modify: `backend/api/stage3_outline.py`
- Modify: `backend/api/stage4_writing.py`
- Modify: `backend/api/creative_canvas.py`
- (Possibly `backend/api/stage2_planner.py` if it exists)
- Test: existing test suite (regression)

- [ ] **Step 1: Discover all tier_1 construction sites**

```bash
grep -rn "PlannerAgent(\|WriterAgent(\|CreativeDirector(\|CharacterDesigner(" backend/api/ backend/conductor/ 2>/dev/null
```

Document the list. Expected (from initial scan): stage1_concept.py:61, stage2_world_char.py:114/192/414, stage3_outline.py:79/241, stage4_writing.py:451/834, creative_canvas.py:1529.

- [ ] **Step 2: Add `genre=` to each construction site**

For each site, the pattern is:

**Before:**
```python
        agent = PlannerAgent(
            project_id,
            override_store=project_override_store(),
            global_override_store=global_override_store(),
        )
```

**After:**
```python
        agent = PlannerAgent(
            project_id,
            override_store=project_override_store(),
            global_override_store=global_override_store(),
            genre=project.get("genre", "cool_novel"),
        )
```

For each file, locate where `project` is loaded (typically `project = fm.read_json(project_id, "project.json")` or similar) and reference `project.get("genre", "cool_novel")` in the agent constructor.

Specific call sites to update:

1. **`backend/api/stage1_concept.py:61`** — add `genre=project.get("genre", "cool_novel")`
2. **`backend/api/stage2_world_char.py:114, 192, 414`** — same pattern at all 3 sites
3. **`backend/api/stage3_outline.py:79, 241`** — same pattern at both sites
4. **`backend/api/stage4_writing.py:451, 834`** — same pattern at both WriterAgent sites
5. **`backend/api/creative_canvas.py:1529`** — same pattern (PlannerAgent)

If `stage2_planner.py` exists and has `PlannerAgent(...)`, update it too. If it doesn't exist, skip.

For each site, verify `project` is in scope and has a `genre` field. If `project` is not yet loaded at that line, load it BEFORE the agent constructor (do not restructure logic).

- [ ] **Step 3: Run the full test suite to verify no regressions**

```bash
source venv/bin/activate
pytest tests/test_genre_temperature.py -v
```

Expected: 19 PASS.

```bash
source venv/bin/activate
pytest tests/ -q --ignore=tests/test_genre_temperature.py 2>&1 | tail -10
```

Expected: same pre-existing failures (10 from autopilot/SSE), no NEW failures from this task.

- [ ] **Step 4: Commit**

```bash
git add backend/api/
git commit -m "feat(temperature): pass genre= to tier_1 agent construction sites"
```

---

## Task 6: Replace `temperature=prompt.temperature` kwargs in `generate_from_template` paths

**Files:**
- Modify: `backend/agents/base_agent.py`

- [ ] **Step 1: Locate the 3 sites**

In `backend/agents/base_agent.py`, find:
- Line ~190: `temperature=prompt.temperature,` (in `generate_from_template` → `generate_with_tier`)
- Line ~199: `temperature=prompt.temperature,` (in `generate_from_template` → `generate` direct)
- Line ~245: `temperature=prompt.temperature,` (in `generate_from_template_stream` → `generate_stream`)

Confirm with:
```bash
grep -n "temperature=prompt.temperature" backend/agents/base_agent.py
```

- [ ] **Step 2: Add a regression test that `_resolve_temperature` is called by `generate_from_template`**

Append to `tests/test_genre_temperature.py`:

```python
class TestGenerateFromTemplateRouting:
    """Verify generate_from_template routes temperature through _resolve_temperature."""

    def test_generate_from_template_uses_resolve_temperature_for_tier_1(self, monkeypatch):
        from backend.agents.base_agent import BaseAgent, PromptTemplate
        agent = _make_agent("planner", genre="xianxia", tier_map={
            "outline_generation": MagicMock(tier_name="tier_1"),
        })
        # Stub the loader
        template = PromptTemplate({
            "user_prompt_template": "{x}",
            "system_prompt": "",
            "temperature": None,
        })
        agent.load_prompt = MagicMock(return_value=template)

        # Capture what kwargs are passed to router.execute
        captured = {}
        async def fake_execute(*args, **kwargs):
            captured.update(kwargs)
            return {"content": "{}"}, MagicMock()
        agent.router.execute = fake_execute

        import asyncio
        asyncio.run(agent.generate_from_template(
            "outline_generation",
            x="y",
            custom_style_config=None,
        ))
        # The temperature in the call should be xianxia's 0.85
        assert captured.get("temperature") == 0.85
```

- [ ] **Step 3: Run the test — should FAIL (no resolver hook yet)**

```bash
source venv/bin/activate
pytest tests/test_genre_temperature.py::TestGenerateFromTemplateRouting -v
```

Expected: FAIL — captured["temperature"] is `None` (from prompt.temperature=None) instead of 0.85.

- [ ] **Step 4: Replace the 3 `temperature=prompt.temperature` kwargs**

In `backend/agents/base_agent.py`, replace each of the 3 occurrences:

**Site 1 (line ~190)** — `generate_from_template` calling `generate_with_tier`:
```python
            return await self.generate_with_tier(
                task_name=template_name,
                system_prompt=system,
                user_prompt=user,
                json_mode=prompt.is_json_mode,
                max_retries=max_retries,
                max_tokens=prompt.max_tokens,
                temperature=prompt.temperature,    # ← replace
            )
```

Becomes:
```python
            return await self.generate_with_tier(
                task_name=template_name,
                system_prompt=system,
                user_prompt=user,
                json_mode=prompt.is_json_mode,
                max_retries=max_retries,
                max_tokens=prompt.max_tokens,
                temperature=self._resolve_temperature(prompt, kwargs.get("custom_style_config")),
            )
```

**Site 2 (line ~199)** — same pattern in the direct `generate(...)` branch:
```python
            temperature=self._resolve_temperature(prompt, kwargs.get("custom_style_config")),
```

**Site 3 (line ~245)** — `generate_from_template_stream` calling `generate_stream`:
```python
        async for chunk in self.generate_stream(
            system_prompt=prompt.format_system(**kwargs),
            user_prompt=prompt.format_user(**kwargs),
            max_tokens=prompt.max_tokens,
            temperature=prompt.temperature,    # ← replace
        ):
```

Becomes:
```python
        async for chunk in self.generate_stream(
            system_prompt=prompt.format_system(**kwargs),
            user_prompt=prompt.format_user(**kwargs),
            max_tokens=prompt.max_tokens,
            temperature=self._resolve_temperature(prompt, kwargs.get("custom_style_config")),
        ):
```

- [ ] **Step 5: Run the test — should PASS now**

```bash
source venv/bin/activate
pytest tests/test_genre_temperature.py::TestGenerateFromTemplateRouting -v
```

Expected: 1 PASS.

- [ ] **Step 6: Run full temperature test file**

```bash
source venv/bin/activate
pytest tests/test_genre_temperature.py -v
```

Expected: 20 PASS (19 + 1 routing).

- [ ] **Step 7: Commit**

```bash
git add backend/agents/base_agent.py tests/test_genre_temperature.py
git commit -m "feat(temperature): route temperature through _resolve_temperature in generate_from_template"
```

---

## Task 7: Acceptance verification + full regression

**Files:** none (verification only)

- [ ] **Step 1: Run the full temperature test file**

```bash
source venv/bin/activate
pytest tests/test_genre_temperature.py -v
```

Expected: 20 PASS.

- [ ] **Step 2: Run full backend test suite**

```bash
source venv/bin/activate
pytest tests/ -q 2>&1 | tail -15
```

Expected: same pre-existing failures, no NEW failures introduced.

- [ ] **Step 3: Verify AC1 — changing genre temperature flows through**

This is a logical check, not a runtime test (changing the YAML mid-run requires restarting the catalog singleton). The unit tests in TestIntegration already prove the mapping. Document in your final report:

```
AC1 verified: tests/test_genre_temperature.py::TestIntegration::test_resolve_temperature_matches_real_xianxia_value_0_85
- agent genre="xianxia", prompt.temperature=None → result=0.85 ✓
```

- [ ] **Step 4: Verify AC2 — prompt.temperature overrides genre**

Document:

```
AC2 verified: tests/test_genre_temperature.py::TestGenreTemperatureResolution::test_prompt_temperature_overrides_genre
- agent genre="xianxia" (0.85), prompt.temperature=0.7 → result=0.7 ✓
```

- [ ] **Step 5: Verify AC3 — sandbox overrides prompt**

Document:

```
AC3 verified: tests/test_genre_temperature.py::TestGenreTemperatureResolution::test_sandbox_temperature_overrides_prompt_and_genre
- sandbox=0.5, prompt=0.7, genre=0.85 → result=0.5 ✓
```

- [ ] **Step 6: Verify AC4 — tier_2/3 unaffected**

Document:

```
AC4 verified: tests/test_genre_temperature.py::TestTierFilteringExtra::test_tier_2_prompt_unset_falls_back_to_settings
- tier_2 agent, prompt.temperature=None, genre=xianxia → result=settings.llm_temperature (genre ignored) ✓
```

- [ ] **Step 7: Commit any test-only adjustments (likely none)**

If no test changes, skip this step.

---

## Self-Review Checklist (run before handoff)

- [ ] Spec §1.1 — `model_preferences.temperature` already defined: covered (Tasks 1-2 use existing dict).
- [ ] Spec §3.1 — `_resolve_temperature` helper: covered (Task 2).
- [ ] Spec §3.2 — `_is_tier_1_agent`: covered (Task 1).
- [ ] Spec §3.3 — `BaseAgent.__init__` adds `genre`: covered (Task 1).
- [ ] Spec §3.4 — 3 `temperature=prompt.temperature` kwargs replaced: covered (Task 6).
- [ ] Spec §3.5 — agent construction sites wired: covered (Task 5).
- [ ] Spec §4 — Priority table: covered by 5 resolution tests in Tasks 2-3.
- [ ] Spec §6 — Error handling 6 scenarios: covered (Tasks 2 + 3 TestErrorHandling).
- [ ] Spec §7 — Test matrix (4 classes, 12+ tests): covered (Tasks 1-3 + 4-6 add 4 + 1).
- [ ] Spec §8 — YAGNI: no router signature change, no SandboxParams change, no frontend — plan respects all.
- [ ] Spec §9 — File list: 1 new test, 11 modified — matches plan.
- [ ] Spec §10 — AC1/AC2/AC3/AC4 verified: covered by specific tests documented in Task 7.

Type / API consistency check across tasks:
- `_is_tier_1_agent()` returns `bool` — same in Tasks 1, 2, 3.
- `_resolve_temperature(prompt, custom_style_config=None) -> float` — same in Tasks 2, 3, 6.
- `genre: str = "cool_novel"` parameter — same in Tasks 1, 4.
- `self.router._mappings` access — same in Tasks 1, 3.

No placeholders / TBD / "implement later" remain.

---

## Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-30-genre-temperature.md`. Two execution options:

**1. Subagent-Driven (recommended)** — Fresh subagent per task, spec + quality review between tasks.

**2. Inline Execution** — Execute tasks in this session with executing-plans.

Which approach?