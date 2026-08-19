# PromptTemplate Dead Attributes Cleanup Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove three dead attributes (`name`, `provider`, `model`) from `PromptTemplate.__init__` and add a focused test asserting they stay gone.

**Architecture:** Single commit, TDD-driven. Write the new test file (which will partially fail until the implementation is changed), then remove the three lines from `PromptTemplate.__init__`, verify both the new test and existing regression tests pass, then commit.

**Tech Stack:** Python 3, pytest.

---

## Task 1: Remove dead attributes from `PromptTemplate` and add regression test

**Files:**
- Create: `tests/test_prompt_template_attrs.py`
- Modify: `backend/agents/base_agent.py:22-24` (delete 3 lines)

- [ ] **Step 1: Create the failing test file**

Create `tests/test_prompt_template_attrs.py` with the following content:

```python
"""Verify vestigial PromptTemplate attributes have been removed."""

from backend.agents.base_agent import PromptTemplate


def _make_template() -> PromptTemplate:
    return PromptTemplate({
        "name": "x",
        "provider": "anthropic",
        "model": "claude-test",
        "system_prompt": "sys",
        "user_prompt_template": "user",
        "temperature": 0.5,
        "max_tokens": 100,
        "output_format": {"type": "json"},
    })


class TestDeadAttributesRemoved:
    def test_model_attr_does_not_exist(self):
        t = _make_template()
        assert not hasattr(t, "model")

    def test_provider_attr_does_not_exist(self):
        t = _make_template()
        assert not hasattr(t, "provider")

    def test_name_attr_does_not_exist(self):
        t = _make_template()
        assert not hasattr(t, "name")


class TestLiveAttributesStillPresent:
    """Sanity check: live attributes are not collateral damage."""

    def test_live_attrs_remain(self):
        t = _make_template()
        assert t.temperature == 0.5
        assert t.max_tokens == 100
        assert t.system_prompt == "sys"
        assert t.user_prompt_template == "user"
        assert t.output_format == {"type": "json"}
        assert t.is_json_mode is True
```

- [ ] **Step 2: Run the new test file and verify the dead-attribute tests fail**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_prompt_template_attrs.py -v`
Expected: 3 failures in `TestDeadAttributesRemoved` (`assert not hasattr(t, "model")` etc.); 1 pass in `TestLiveAttributesStillPresent`. The dead-attribute tests fail because `PromptTemplate.__init__` still sets these attributes today.

- [ ] **Step 3: Remove the three dead attribute lines from `PromptTemplate.__init__`**

Edit `backend/agents/base_agent.py:20-29`. Replace the `PromptTemplate` class body with:

```python
class PromptTemplate:
    def __init__(self, data: dict):
        self.temperature: float = data.get("temperature", settings.llm_temperature)
        self.max_tokens: int = data.get("max_tokens", settings.llm_max_tokens)
        self.system_prompt: str = data.get("system_prompt", "")
        self.user_prompt_template: str = data.get("user_prompt_template", "")
        self.output_format: dict = data.get("output_format", {})
```

Changes from the original:
- Removed line 22: `self.name: str = data.get("name", "")`
- Removed line 23: `self.provider: str = data.get("provider", settings.llm_provider)`
- Removed line 24: `self.model: str = data.get("model", settings.llm_model)`

The remaining lines (25–29) and the methods `format_system`, `format_user`, and the `is_json_mode` property are untouched. The `settings` import remains in use for the `temperature` and `max_tokens` defaults at lines 25–26.

- [ ] **Step 4: Re-run the new test file and verify all tests pass**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_prompt_template_attrs.py -v`
Expected: 4 tests pass (3 in `TestDeadAttributesRemoved`, 1 in `TestLiveAttributesStillPresent`).

- [ ] **Step 5: Run the regression suite for the two files that directly construct `PromptTemplate`**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_user_modifications.py tests/test_genre_temperature.py -v`
Expected: All tests pass. These tests construct `PromptTemplate` directly but never read the removed attributes, so they should be unaffected.

- [ ] **Step 6: Run the full backend test suite to confirm no regression**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/ -q`
Expected: All tests pass (the new 4 tests plus the full existing suite).

- [ ] **Step 7: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add tests/test_prompt_template_attrs.py backend/agents/base_agent.py
git commit -m "refactor(agents): drop dead name/provider/model attrs from PromptTemplate

These three attributes are set in PromptTemplate.__init__ but never
read by the LLM call chain. Model routing is handled by
ModelRouter.resolve from config/model_tiers.yaml. Drop the attributes
and add a focused test asserting they stay gone.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Self-Review Checklist (run after implementation)

- [ ] `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_prompt_template_attrs.py -v` — 4 passed
- [ ] `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/ -q` — full suite green
- [ ] `grep -n "self\.\(name\|provider\|model\)" backend/agents/base_agent.py` — no matches in `PromptTemplate.__init__` (line 20-29)
- [ ] Git log: 1 new commit on top of `d582836`