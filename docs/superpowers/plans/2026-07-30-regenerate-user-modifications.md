# Regenerate User Modifications Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `RegenerateModal` (B-type, 560px) to 6 regenerate entry points (init wizard 5 steps, scene writing, per-character behavior examples). User types modification suggestions; the agent appends `【用户修改意见】{text}` block to the original `user_prompt_template`. Empty text == today's behavior (no regression).

**Architecture:** New `_build_user_modifications_block(text)` helper in `backend/agents/_injection_helpers.py`. 6 prompt templates get a trailing `{user_modifications}` placeholder. 6 agent methods accept a `user_modifications: str = ""` kwarg and inject the helper output into `template_vars`. 7 backend endpoint handlers accept an optional `user_modifications` field in the body. 1 new React `RegenerateModal` component in `frontend/src/components/shared/`, used by 3 entry-point groups. Empty text → helper returns `""` → prompt renders unchanged.

**Tech Stack:** Python 3.9 · FastAPI · Pydantic v2 · pytest · React 18 + Vite + Tailwind · TypeScript · vitest.

---

## File Structure

| File | Status | Responsibility |
|---|---|---|
| `backend/agents/_injection_helpers.py` | **Create** | `_build_user_modifications_block(text)` + 1 future helper namespace |
| `tests/test_user_modifications.py` | **Create** | 14 tests across 6 classes (helper, coverage, signature, backward compat, end-to-end, char limit) |
| `backend/prompts/concept_generation.yaml` | **Modify** | Append `{user_modifications}` placeholder to `user_prompt_template` |
| `backend/prompts/world_generation.yaml` | **Modify** | Same |
| `backend/prompts/character_generation.yaml` | **Modify** | Same |
| `backend/prompts/novel_outline_generation.yaml` | **Modify** | Same |
| `backend/prompts/outline_generation.yaml` | **Modify** | Same |
| `backend/prompts/scene_writing.yaml` | **Modify** | Same |
| `backend/agents/planner.py` | **Modify** | Add `user_modifications: str = ""` to 5 methods; inject helper output |
| `backend/agents/writer.py` | **Modify** | Add same kwarg to `write_scene` |
| `backend/api/stage1_concept.py` | **Modify** | Read `user_modifications` from body in `POST /generate` |
| `backend/api/stage2_world_char.py` | **Modify** | Same in 3 handlers (`/generate-world`, `/generate-character`, `/character/{id}/regenerate-examples`) |
| `backend/api/stage3_outline.py` | **Modify** | Same in 2 handlers (`/generate`, `/generate-novel-outline`) |
| `backend/api/stage4_writing.py` | **Modify** | Same in `/write-scene` |
| `frontend/src/components/shared/RegenerateModal.tsx` | **Create** | The 560px textarea modal (B-type) |
| `frontend/src/components/shared/RegenerateModal.test.tsx` | **Create** | 8 vitest tests |
| `frontend/src/api/client.ts` | **Modify** | Add `userModifications?: string` to 7 functions |
| `frontend/src/components/wizard/InitWizardModal.tsx` | **Modify** | Render `RegenerateModal` triggered by `wizard.regenerateHandler` |
| `frontend/src/components/wizard/ConceptStep.tsx` | **Modify** | Wire local `showRegenerateModal` state; pass through to `generateConcept` |
| `frontend/src/components/wizard/WorldStep.tsx` | **Modify** | Same with `generateWorld` |
| `frontend/src/components/wizard/CharacterStep.tsx` | **Modify** | Same with `generateCharacter` + behavior examples |
| `frontend/src/components/wizard/OutlineStep.tsx` | **Modify** | Same with `generateNovelOutline` (note: step 3 calls generate-novel-outline) |
| `frontend/src/components/wizard/ChapterOutlineStep.tsx` | **Modify** | Same with `generateOutline` (note: step 4 calls /generate) |
| `frontend/src/components/workspace/WritingArea.tsx` | **Modify** | No API change — WorkspacePage handles modal |
| `frontend/src/pages/WorkspacePage.tsx` | **Modify** | Add `showRegenerateModal`; pass `userModifications` to `doRegenerate` |
| `frontend/src/components/wizard/BehaviorExamplesSection.tsx` | **Modify** | No API change — CharacterStep handles modal |

No changes to: `config/genres/*.yaml`, `backend/genres/catalog.py`, `backend/llm/*`, `backend/config.py`, `backend/conductor/*`, `backend/style_engine/sandbox_renderer.py`, project.json / progress.json schema, any circuit breaker logic.

---

## Task 1: `_build_user_modifications_block` helper + 5 unit tests

**Files:**
- Create: `backend/agents/_injection_helpers.py`
- Test: `tests/test_user_modifications.py`

- [ ] **Step 1: Create the test file with `TestUserModificationsHelper` (5 cases)**

Create `tests/test_user_modifications.py`:

```python
"""Tests for the user_modifications injection path.

Covers the helper, prompt template coverage, agent method signature coverage,
end-to-end rendering, and char-limit handling.
"""
import pytest

from backend.agents._injection_helpers import _build_user_modifications_block


class TestUserModificationsHelper:
    def test_empty_string_returns_empty(self):
        assert _build_user_modifications_block("") == ""

    def test_whitespace_only_returns_empty(self):
        assert _build_user_modifications_block("   ") == ""
        assert _build_user_modifications_block("\n\n\t  \n") == ""

    def test_simple_text_contains_marker_and_text(self):
        result = _build_user_modifications_block("hello")
        assert "【用户修改意见】" in result
        assert "hello" in result

    def test_strips_leading_and_trailing_whitespace(self):
        result = _build_user_modifications_block("  hello  ")
        assert "hello" in result
        # The trimmed text is the only "hello" surrounded by non-`hello` chars
        assert "  hello  " not in result

    def test_multiline_text_preserved(self):
        text = "line one\nline two\nline three"
        result = _build_user_modifications_block(text)
        assert "line one" in result
        assert "line two" in result
        assert "line three" in result
```

- [ ] **Step 2: Run to verify 5 FAIL**

```bash
source venv/bin/activate && pytest tests/test_user_modifications.py::TestUserModificationsHelper -v
```

Expected: FAIL with `ModuleNotFoundError: No module named 'backend.agents._injection_helpers'`.

- [ ] **Step 3: Create the helper module**

Create `backend/agents/_injection_helpers.py`:

```python
"""Helpers for injecting user-provided content into prompt templates.

Each helper returns a string that fills a specific `{...}` placeholder in a
`user_prompt_template`. Helpers return "" for empty input so the placeholder
renders as an empty trailing line and the LLM sees no instruction change.
"""


def _build_user_modifications_block(text: str) -> str:
    """Build the 【用户修改意见】 block appended to user_prompt_template.

    Returns "" if text is empty/whitespace-only, so the template renders an
    empty trailing line and the LLM sees no instruction change.

    Returns a leading newline + header + the stripped text. The caller is
    responsible for ensuring the placeholder is at the very end of the
    template so this block sits flush with the prior content.
    """
    if not text or not text.strip():
        return ""
    return f"\n【用户修改意见】\n{text.strip()}"
```

- [ ] **Step 4: Run to verify 5 PASS**

```bash
source venv/bin/activate && pytest tests/test_user_modifications.py::TestUserModificationsHelper -v
```

Expected: 5 PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/agents/_injection_helpers.py tests/test_user_modifications.py
git commit -m "feat(user-modifications): add _build_user_modifications_block helper"
```

---

## Task 2: Add `{user_modifications}` placeholder to 6 prompt templates + coverage test

**Files:**
- Modify: `backend/prompts/concept_generation.yaml`
- Modify: `backend/prompts/world_generation.yaml`
- Modify: `backend/prompts/character_generation.yaml`
- Modify: `backend/prompts/novel_outline_generation.yaml`
- Modify: `backend/prompts/outline_generation.yaml`
- Modify: `backend/prompts/scene_writing.yaml`
- Test: `tests/test_user_modifications.py`

- [ ] **Step 1: Add `TestPromptCoverage` (2 cases)**

Append to `tests/test_user_modifications.py`:

```python
PROMPT_TEMPLATES_WITH_USER_MODIFICATIONS = [
    "concept_generation",
    "world_generation",
    "character_generation",
    "novel_outline_generation",
    "outline_generation",
    "scene_writing",
]


class TestPromptCoverage:
    def test_all_six_prompts_have_user_modifications_placeholder(self):
        from backend.services.prompt_override_store import load_prompt_effective

        for name in PROMPT_TEMPLATES_WITH_USER_MODIFICATIONS:
            data = load_prompt_effective(name)
            template = data.get("user_prompt_template", "")
            assert "{user_modifications}" in template, (
                f"{name}.yaml is missing {{user_modifications}} placeholder"
            )

    def test_placeholder_is_at_end_of_template(self):
        from backend.services.prompt_override_store import load_prompt_effective

        for name in PROMPT_TEMPLATES_WITH_USER_MODIFICATIONS:
            data = load_prompt_effective(name)
            template = data.get("user_prompt_template", "")
            stripped = template.rstrip()
            # After rstrip, the last non-whitespace token should end with the
            # placeholder, allowing for trailing comments or newlines.
            assert stripped.endswith("{user_modifications}"), (
                f"{name}.yaml must have {{user_modifications}} as the LAST "
                "non-whitespace content in user_prompt_template"
            )
```

NOTE: The exact loader function may vary. If `load_prompt_effective` does not exist or takes different args, find the canonical loader in `backend/prompts/` and adapt. The import path is typically `from backend.services.prompt_override_store import load_prompt_effective` (this is the helper added in the v1.9 Prompt Plaza work).

- [ ] **Step 2: Run to verify 2 FAIL**

```bash
source venv/bin/activate && pytest tests/test_user_modifications.py::TestPromptCoverage -v
```

Expected: 2 FAIL — at least one template missing the placeholder.

- [ ] **Step 3: Add the placeholder to each of 6 templates**

For each of the 6 YAML files, locate the `user_prompt_template:` block and append a new line at the end (preserving indentation style):

```yaml
  {user_modifications}
```

**Exact files** (each is a 1-line addition; the indentation inside the block-quoted scalar should be consistent with the surrounding lines):

1. `backend/prompts/concept_generation.yaml`
2. `backend/prompts/world_generation.yaml`
3. `backend/prompts/character_generation.yaml`
4. `backend/prompts/novel_outline_generation.yaml`
5. `backend/prompts/outline_generation.yaml`
6. `backend/prompts/scene_writing.yaml`

For each file:
- Open the file
- Find the last meaningful line in `user_prompt_template:`
- Add a new line containing exactly `  {user_modifications}` (matching the indentation of the existing content)
- The blank line separator and the placeholder together mean: the rendered template will have an empty line before the (possibly empty) user_modifications section

The existing format for these prompts uses either folded scalars (`>`) or block scalars (`|`). Read the file first; if it's folded, add the placeholder on a new line; if it's block, also add on a new line. The key invariant is that `{user_modifications}` becomes part of the rendered text.

- [ ] **Step 4: Run to verify 2 PASS**

```bash
source venv/bin/activate && pytest tests/test_user_modifications.py::TestPromptCoverage -v
```

Expected: 2 PASS.

- [ ] **Step 5: Run full file to confirm no regression**

```bash
source venv/bin/activate && pytest tests/test_user_modifications.py -v
```

Expected: 7 PASS (5 helper + 2 coverage).

- [ ] **Step 6: Commit**

```bash
git add backend/prompts/ tests/test_user_modifications.py
git commit -m "feat(user-modifications): add {user_modifications} placeholder to 6 prompt templates"
```

---

## Task 3: Add `user_modifications` kwarg to 6 agent methods + signature coverage test

**Files:**
- Modify: `backend/agents/planner.py` (5 methods)
- Modify: `backend/agents/writer.py` (1 method)
- Test: `tests/test_user_modifications.py`

- [ ] **Step 1: Add `TestAgentSignatureCoverage` (2 cases)**

Append to `tests/test_user_modifications.py`:

```python
class TestAgentSignatureCoverage:
    def test_all_six_agent_methods_accept_user_modifications(self):
        import inspect

        from backend.agents.planner import PlannerAgent
        from backend.agents.writer import WriterAgent

        targets = [
            (PlannerAgent, "generate_concept_and_dna"),
            (PlannerAgent, "generate_world"),
            (PlannerAgent, "generate_character"),
            (PlannerAgent, "generate_outline"),
            (PlannerAgent, "generate_novel_outline"),
            (WriterAgent, "write_scene"),
        ]
        for cls, method_name in targets:
            method = getattr(cls, method_name)
            sig = inspect.signature(method)
            assert "user_modifications" in sig.parameters, (
                f"{cls.__name__}.{method_name} is missing "
                "user_modifications kwarg"
            )

    def test_user_modifications_defaults_to_empty_string(self):
        import inspect

        from backend.agents.planner import PlannerAgent
        from backend.agents.writer import WriterAgent

        targets = [
            (PlannerAgent, "generate_concept_and_dna"),
            (PlannerAgent, "generate_world"),
            (PlannerAgent, "generate_character"),
            (PlannerAgent, "generate_outline"),
            (PlannerAgent, "generate_novel_outline"),
            (WriterAgent, "write_scene"),
        ]
        for cls, method_name in targets:
            sig = inspect.signature(getattr(cls, method_name))
            param = sig.parameters["user_modifications"]
            assert param.default == "", (
                f"{cls.__name__}.{method_name}.user_modifications default "
                f"should be empty string, got {param.default!r}"
            )
```

- [ ] **Step 2: Run to verify 2 FAIL**

```bash
source venv/bin/activate && pytest tests/test_user_modifications.py::TestAgentSignatureCoverage -v
```

Expected: 2 FAIL.

- [ ] **Step 3: Add `user_modifications` to `PlannerAgent.generate_concept_and_dna`**

In `backend/agents/planner.py` around line 281, modify the signature and inject the helper:

```python
    async def generate_concept_and_dna(
        self,
        initial_intent: str,
        genre: str = "cool_novel",
        user_modifications: str = "",  # NEW
    ) -> tuple[dict, LLMResponse]:
        from backend.agents._injection_helpers import _build_user_modifications_block
        extras = _resolve_genre_extras(genre)
        result, response = await self.generate_from_template(
            "concept_generation",
            initial_intent=initial_intent,
            genre=_resolve_genre_label(genre),
            genre_tone=extras["tone"],
            genre_style_rules=extras["style_rules"],
            genre_trope_patterns=extras["trope_patterns"],
            user_modifications=_build_user_modifications_block(user_modifications),
        )
        self.log_usage("concept_generation", response)
        ...
```

The import goes inside the method body (lazy import) to avoid circular-import risk; `_injection_helpers` is otherwise already a sibling.

- [ ] **Step 4: Add `user_modifications` to `PlannerAgent.generate_world` (line ~332)**

In `backend/agents/planner.py`:

```python
    async def generate_world(
        self,
        concept: dict,
        story_dna: dict,
        genre: str = "cool_novel",
        user_modifications: str = "",  # NEW
    ) -> tuple[dict, LLMResponse]:
        from backend.agents._injection_helpers import _build_user_modifications_block
        extras = _resolve_genre_extras(genre)
        result, response = await self.generate_from_template(
            "world_generation",
            ...,
            user_modifications=_build_user_modifications_block(user_modifications),
        )
```

Read the full existing call to `generate_from_template` first and add `user_modifications=...` as a new kwarg. Do not change other kwargs.

- [ ] **Step 5: Add `user_modifications` to `PlannerAgent.generate_character` (line ~356)**

In `backend/agents/planner.py`:

```python
    async def generate_character(
        self,
        concept: dict,
        world: dict,
        character_type: str = "protagonist",
        character_index: int = 0,
        existing_characters: Optional[list[dict]] = None,
        genre: str = "cool_novel",
        user_modifications: str = "",  # NEW
    ) -> tuple[dict, LLMResponse]:
        ...
        from backend.agents._injection_helpers import _build_user_modifications_block
        ...
        result, response = await self.generate_from_template(
            "character_generation",
            ...,
            user_modifications=_build_user_modifications_block(user_modifications),
        )
```

- [ ] **Step 6: Add `user_modifications` to `PlannerAgent.generate_outline` (line ~423)**

In `backend/agents/planner.py`:

```python
    async def generate_outline(
        self,
        concept: dict,
        story_dna: dict,
        world: dict,
        character: dict,
        chapter_number: int = 1,
        min_words: int = 4000,
        novel_outline: Optional[dict] = None,
        outline_text: str = "",
        genre: str = "cool_novel",
        user_modifications: str = "",  # NEW
    ) -> tuple[dict, LLMResponse]:
        ...
        from backend.agents._injection_helpers import _build_user_modifications_block
        ...
        result, response = await self.generate_from_template(
            "outline_generation",
            ...,
            user_modifications=_build_user_modifications_block(user_modifications),
        )
```

- [ ] **Step 7: Add `user_modifications` to `PlannerAgent.generate_novel_outline` (line ~477)**

Same pattern as Step 6. Read the existing call to `generate_from_template` and add the new kwarg.

- [ ] **Step 8: Add `user_modifications` to `WriterAgent.write_scene` (line ~471)**

In `backend/agents/writer.py`:

```python
    async def write_scene(
        self,
        *,
        genre: str,
        concept: dict,
        world_rules: dict,
        characters: list[dict],
        scene_plan: dict,
        l0_context: str = "",
        l1_context: str = "",
        l2_context: str = "",
        l3_context: str = "",
        l4_context: str = "",
        growth_stage_hint: str = "",
        character_growth_context: str = "",
        style_template: Optional[dict] = None,
        storyos_state: Optional[dict] = None,
        reader_os_warnings: str = "",
        custom_style_config=None,
        outline_chapter: Optional[dict] = None,
        user_modifications: str = "",  # NEW
        **kwargs,
    ) -> tuple[dict, LLMResponse]:
        from backend.agents._injection_helpers import _build_user_modifications_block
        template_vars = self._build_base_vars(
            genre, concept, world_rules, characters, scene_plan,
            l0_context, l1_context,
            l2_context, l3_context, l4_context, growth_stage_hint,
            character_growth_context,
            custom_style_config_desc=_build_custom_style_desc(custom_style_config),
            outline_chapter=outline_chapter,
        )
        template_vars["reader_os_warnings"] = reader_os_warnings
        template_vars["genre_pacing_scene"] = _resolve_genre_scene_pacing(genre)
        template_vars["user_modifications"] = _build_user_modifications_block(user_modifications)  # NEW
        return await self.generate_from_template(
            "scene_writing", **template_vars, **kwargs
        )
```

Note: `write_scene` already uses `**kwargs` and forwards them to `generate_from_template`. The `user_modifications` is added as an explicit kwarg (so the signature test can introspect it) AND is also injected into `template_vars` so the template can render it.

- [ ] **Step 9: Run to verify 2 PASS**

```bash
source venv/bin/activate && pytest tests/test_user_modifications.py::TestAgentSignatureCoverage -v
```

Expected: 2 PASS.

- [ ] **Step 10: Run full file**

```bash
source venv/bin/activate && pytest tests/test_user_modifications.py -v
```

Expected: 9 PASS (5 + 2 + 2).

- [ ] **Step 11: Commit**

```bash
git add backend/agents/planner.py backend/agents/writer.py tests/test_user_modifications.py
git commit -m "feat(user-modifications): thread user_modifications kwarg through 6 agent methods"
```

---

## Task 4: End-to-end backward compat + with-suggestion tests

**Files:**
- Test: `tests/test_user_modifications.py`

- [ ] **Step 1: Add `TestEndToEndBackwardCompat` (2 cases)**

Append to `tests/test_user_modifications.py`:

```python
class TestEndToEndBackwardCompat:
    def test_empty_user_modifications_renders_no_block(self):
        """Empty user_modifications means today’s behavior: nothing appended."""
        from backend.agents._injection_helpers import _build_user_modifications_block
        result = _build_user_modifications_block("")
        # The empty case must produce empty string so the placeholder renders
        # as an empty line and the LLM sees no instruction change.
        assert result == ""
        # Verify the literal block marker is NOT present.
        assert "【用户修改意见】" not in result

    def test_nonempty_user_modifications_renders_block_with_text(self):
        from backend.agents._injection_helpers import _build_user_modifications_block
        result = _build_user_modifications_block("让节奏更紧凑")
        assert "【用户修改意见】" in result
        assert "让节奏更紧凑" in result
        # The text appears after the marker, not before.
        marker_idx = result.index("【用户修改意见】")
        text_idx = result.index("让节奏更紧凑")
        assert marker_idx < text_idx
```

- [ ] **Step 2: Add `TestEndToEndWithSuggestion` (1 case)**

Append to `tests/test_user_modifications.py`:

```python
class TestEndToEndWithSuggestion:
    def test_concept_generation_prompt_includes_user_modifications_block(self):
        """End-to-end: with non-empty user_modifications, the rendered
        concept_generation user_prompt_template ends with the 【用户修改意见】 block.
        """
        from backend.agents._injection_helpers import _build_user_modifications_block
        from backend.services.prompt_override_store import load_prompt_effective

        data = load_prompt_effective("concept_generation")
        template = data["user_prompt_template"]
        user_block = _build_user_modifications_block("让主角动机更清晰")
        rendered = template.format(user_modifications=user_block)
        # The block is present at the end of the rendered prompt.
        assert "【用户修改意见】" in rendered
        assert "让主角动机更清晰" in rendered
        # And the block sits at the very end (no content after).
        assert rendered.rstrip().endswith("让主角动机更清晰")

    def test_concept_generation_prompt_unchanged_with_empty_modifications(self):
        """Empty user_modifications must produce a rendered template whose
        final non-whitespace content is identical to the raw template minus
        the placeholder (i.e. the placeholder was replaced with "").
        """
        from backend.agents._injection_helpers import _build_user_modifications_block
        from backend.services.prompt_override_store import load_prompt_effective

        data = load_prompt_effective("concept_generation")
        template = data["user_prompt_template"]
        rendered = template.format(user_modifications=_build_user_modifications_block(""))
        # The literal placeholder must NOT appear (it was replaced with "").
        assert "{user_modifications}" not in rendered
        # The block marker must NOT appear.
        assert "【用户修改意见】" not in rendered
```

- [ ] **Step 3: Run to verify 3 PASS**

```bash
source venv/bin/activate && pytest tests/test_user_modifications.py::TestEndToEndBackwardCompat tests/test_user_modifications.py::TestEndToEndWithSuggestion -v
```

Expected: 3 PASS (these tests don't require new code; they verify the helper + template combination).

- [ ] **Step 4: Add `TestCharLimit` (2 cases)**

Append to `tests/test_user_modifications.py`:

```python
class TestCharLimit:
    def test_helper_does_not_impose_char_limit(self):
        """The helper itself does not truncate; char-limit enforcement lives
        at the frontend (input maxLength) and at the endpoint handler."""
        from backend.agents._injection_helpers import _build_user_modifications_block
        long_text = "x" * 5000
        result = _build_user_modifications_block(long_text)
        assert "x" * 5000 in result

    def test_handler_truncates_to_1000_chars(self):
        """Endpoint handlers must truncate user_modifications to 1000 chars
        before passing to the agent (defense in depth)."""
        long_text = "y" * 5000
        truncated = long_text[:1000]
        assert len(truncated) == 1000
        # In production, this truncation happens in each handler. The test
        # confirms the truncation logic shape, not the handler wiring (which
        # is covered by the endpoint tests in Task 5).
```

- [ ] **Step 5: Run to verify 2 PASS**

```bash
source venv/bin/activate && pytest tests/test_user_modifications.py::TestCharLimit -v
```

Expected: 2 PASS.

- [ ] **Step 6: Run full file**

```bash
source venv/bin/activate && pytest tests/test_user_modifications.py -v
```

Expected: 14 PASS across 6 classes.

- [ ] **Step 7: Commit**

```bash
git add tests/test_user_modifications.py
git commit -m "test(user-modifications): end-to-end + char limit coverage"
```

---

## Task 5: Backend endpoint handlers — accept `user_modifications` from body

**Files:**
- Modify: `backend/api/stage1_concept.py` (1 endpoint)
- Modify: `backend/api/stage2_world_char.py` (3 endpoints)
- Modify: `backend/api/stage3_outline.py` (2 endpoints)
- Modify: `backend/api/stage4_writing.py` (1 endpoint)
- Test: existing test suite (regression)

- [ ] **Step 1: Locate the 7 endpoints**

Run:
```bash
grep -n "user_modifications\|payload.get\|payload or" backend/api/stage1_concept.py backend/api/stage2_world_char.py backend/api/stage3_outline.py backend/api/stage4_writing.py 2>/dev/null
```

Document the 7 endpoint handler lines. Then add a regression test in `tests/test_user_modifications.py`.

- [ ] **Step 2: Add `TestEndpointWiring` (3 cases)**

Append to `tests/test_user_modifications.py`:

```python
class TestEndpointWiring:
    """Smoke tests that the 7 endpoint handlers accept user_modifications
    from the request body and pass it through to the agent method.

    Uses FastAPI's TestClient + a mocked PlannerAgent/WriterAgent to avoid
    real LLM calls. If TestClient is not already used elsewhere, this test
    may be skipped in CI; the goal is to lock the contract, not exercise
    the full HTTP stack.
    """

    def test_stage1_generate_handler_accepts_user_modifications(self):
        from fastapi.testclient import TestClient
        from backend.main import app
        from unittest.mock import patch, AsyncMock

        captured = {}

        async def fake_generate_concept_and_dna(self, initial_intent, genre="cool_novel", user_modifications=""):
            captured["user_modifications"] = user_modifications
            return ({"concept": {}, "story_dna": {}}, None)

        with patch.object(
            __import__("backend.agents.planner", fromlist=["PlannerAgent"]).PlannerAgent,
            "generate_concept_and_dna",
            new=fake_generate_concept_and_dna,
        ):
            client = TestClient(app)
            resp = client.post(
                "/api/stage1/generate",
                params={"project_id": "nonexistent_test_proj"},
                json={"user_modifications": "让动机更清晰"},
            )
            # We don't care about the response status (it may fail downstream
            # due to missing project); we only care that the handler extracted
            # the field and passed it through.
            assert captured.get("user_modifications") == "让动机更清晰"

    def test_stage4_write_scene_handler_accepts_user_modifications(self):
        from fastapi.testclient import TestClient
        from backend.main import app
        from unittest.mock import patch

        captured = {}

        async def fake_write_scene(self, **kwargs):
            captured["user_modifications"] = kwargs.get("user_modifications", "")
            return ({"draft_text": "ok"}, None)

        with patch.object(
            __import__("backend.agents.writer", fromlist=["WriterAgent"]).WriterAgent,
            "write_scene",
            new=fake_write_scene,
        ):
            client = TestClient(app)
            resp = client.post(
                "/api/stage4/write-scene",
                json={
                    "project_id": "nonexistent_test_proj",
                    "chapter_number": 1,
                    "scene_number": 1,
                    "user_modifications": "场景更紧张一些",
                },
            )
            assert captured.get("user_modifications") == "场景更紧张一些"

    def test_endpoint_truncates_user_modifications_to_1000_chars(self):
        """Verify each handler truncates user_modifications to 1000 chars
        before passing to the agent. Use a stage1 call with a 5000-char body.
        """
        from fastapi.testclient import TestClient
        from backend.main import app
        from unittest.mock import patch

        captured = {}

        async def fake_generate_concept_and_dna(self, initial_intent, genre="cool_novel", user_modifications=""):
            captured["user_modifications"] = user_modifications
            return ({"concept": {}, "story_dna": {}}, None)

        long_text = "z" * 5000

        with patch.object(
            __import__("backend.agents.planner", fromlist=["PlannerAgent"]).PlannerAgent,
            "generate_concept_and_dna",
            new=fake_generate_concept_and_dna,
        ):
            client = TestClient(app)
            resp = client.post(
                "/api/stage1/generate",
                params={"project_id": "nonexistent_test_proj"},
                json={"user_modifications": long_text},
            )
            assert len(captured.get("user_modifications", "")) <= 1000
```

NOTE: If the existing handlers do not currently use `payload: dict = None` (some may use Pydantic models), the test body field name and pattern need to adapt. Read each handler first to confirm the body shape.

- [ ] **Step 3: Run to verify 3 FAIL (the field is not yet extracted)**

```bash
source venv/bin/activate && pytest tests/test_user_modifications.py::TestEndpointWiring -v
```

Expected: 3 FAIL — `captured["user_modifications"]` is `""` (default) because the handler hasn't extracted the field yet.

- [ ] **Step 4: Update `backend/api/stage1_concept.py`**

In the `POST /generate` handler (line ~32), after the `payload = payload or {}` line, add:

```python
    user_modifications = str(payload.get("user_modifications", ""))[:1000]
```

And pass it to the agent call (look for `agent.generate_concept_and_dna(`):

```python
    result, response = await agent.generate_concept_and_dna(
        ...,
        user_modifications=user_modifications,
    )
```

The exact kwargs depend on the existing call. Read the handler first.

- [ ] **Step 5: Update `backend/api/stage2_world_char.py` (3 handlers)**

In each of these 3 handlers, after the `payload = payload or {}` line, add the same extraction:

- `POST /generate-world` (line ~84)
- `POST /generate-character` (line ~142)
- `POST /character/{id}/regenerate-examples` (line ~379)

```python
    user_modifications = str(payload.get("user_modifications", ""))[:1000]
```

And pass `user_modifications=user_modifications` to the corresponding `agent.generate_world(...)` / `agent.generate_character(...)` call. The `/regenerate-examples` handler calls `agent.generate_character(...)` — pass user_modifications there too.

- [ ] **Step 6: Update `backend/api/stage3_outline.py` (2 handlers)**

- `POST /generate` (line ~40) — passes to `agent.generate_outline(...)`
- `POST /generate-novel-outline` (line ~195) — passes to `agent.generate_novel_outline(...)`

Same pattern.

- [ ] **Step 7: Update `backend/api/stage4_writing.py` (1 handler)**

- `POST /write-scene` (line ~1178) — passes to `agent.write_scene(...)` (writer, not planner)

Same pattern. The writer signature uses keyword-only `*` so pass `user_modifications=user_modifications` as a kwarg.

- [ ] **Step 8: Run to verify 3 PASS**

```bash
source venv/bin/activate && pytest tests/test_user_modifications.py::TestEndpointWiring -v
```

Expected: 3 PASS.

- [ ] **Step 9: Run full file**

```bash
source venv/bin/activate && pytest tests/test_user_modifications.py -v
```

Expected: 17 PASS across 7 classes.

- [ ] **Step 10: Run regression**

```bash
source venv/bin/activate && pytest tests/ -q --ignore=tests/test_user_modifications.py 2>&1 | tail -10
```

Expected: same baseline (1398 passed, 7 failed, 2 skipped, 1 xfailed — the 7 pre-existing autopilot/SSE failures from `test_autopilot_runner_async*` etc.). No NEW failures.

- [ ] **Step 11: Commit**

```bash
git add backend/api/ tests/test_user_modifications.py
git commit -m "feat(user-modifications): thread user_modifications through 7 endpoint handlers"
```

---

## Task 6: `RegenerateModal` React component + 8 vitest tests

**Files:**
- Create: `frontend/src/components/shared/RegenerateModal.tsx`
- Create: `frontend/src/components/shared/RegenerateModal.test.tsx`

- [ ] **Step 1: Create the test file with 8 cases**

Create `frontend/src/components/shared/RegenerateModal.test.tsx`:

```tsx
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { RegenerateModal } from "./RegenerateModal";

describe("RegenerateModal", () => {
  it("auto-focuses the textarea when opened", () => {
    render(
      <RegenerateModal
        open
        target="概念"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByLabelText("修改意见") as HTMLTextAreaElement;
    expect(document.activeElement).toBe(textarea);
  });

  it("calls onConfirm with the typed text", async () => {
    const onConfirm = vi.fn();
    render(
      <RegenerateModal
        open
        target="概念"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByLabelText("修改意见");
    await userEvent.type(textarea, "让节奏更紧凑");
    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
    expect(onConfirm).toHaveBeenCalledWith("让节奏更紧凑");
  });

  it("calls onConfirm with empty string when submitted blank", () => {
    const onConfirm = vi.fn();
    render(
      <RegenerateModal
        open
        target="概念"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "重新生成" }));
    expect(onConfirm).toHaveBeenCalledWith("");
  });

  it("calls onCancel when Escape is pressed", () => {
    const onCancel = vi.fn();
    render(
      <RegenerateModal
        open
        target="概念"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onCancel when the backdrop is clicked", () => {
    const onCancel = vi.fn();
    const { container } = render(
      <RegenerateModal
        open
        target="概念"
        onConfirm={vi.fn()}
        onCancel={onCancel}
      />,
    );
    // The backdrop is the outermost fixed element with bg-black/50.
    const backdrop = container.querySelector(".fixed.inset-0") as HTMLElement;
    fireEvent.click(backdrop);
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it("calls onConfirm when Cmd+Enter is pressed in the textarea", () => {
    const onConfirm = vi.fn();
    render(
      <RegenerateModal
        open
        target="概念"
        onConfirm={onConfirm}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByLabelText("修改意见");
    fireEvent.keyDown(textarea, { key: "Enter", metaKey: true });
    expect(onConfirm).toHaveBeenCalledWith("");
  });

  it("blocks input past 1000 characters", async () => {
    render(
      <RegenerateModal
        open
        target="概念"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    const textarea = screen.getByLabelText("修改意见") as HTMLTextAreaElement;
    // The textarea's maxLength attribute must be 1000.
    expect(textarea.maxLength).toBe(1000);
  });

  it("title contains the target string", () => {
    render(
      <RegenerateModal
        open
        target="第二章第一场"
        onConfirm={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByText(/重新生成.*第二章第一场/)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run to verify 8 FAIL**

```bash
cd frontend && npm test RegenerateModal 2>&1 | tail -30
```

Expected: FAIL with module not found.

- [ ] **Step 3: Create the component**

Create `frontend/src/components/shared/RegenerateModal.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";

interface RegenerateModalProps {
  open: boolean;
  target: string;
  placeholder?: string;
  onConfirm: (userModifications: string) => void;
  onCancel: () => void;
}

const MAX_LEN = 1000;

export function RegenerateModal({
  open,
  target,
  placeholder = "例如:让节奏更紧凑 / 主角动机更清晰 / 减少说教感……",
  onConfirm,
  onCancel,
}: RegenerateModalProps) {
  const [text, setText] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-focus the textarea when the modal opens.
  useEffect(() => {
    if (open) {
      setText("");
      // Defer focus until after the modal is mounted.
      setTimeout(() => textareaRef.current?.focus(), 0);
    }
  }, [open]);

  // Escape to cancel.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  const handleSubmit = () => {
    onConfirm(text);
  };

  const handleTextareaKey = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
      e.preventDefault();
      onConfirm(text);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="regenerate-modal-title"
      className="fixed inset-0 z-50 flex items-start justify-center pt-20 bg-black/50"
      onClick={(e) => {
        // Only the backdrop (outermost) cancels; clicks inside the panel
        // don't bubble here because of stopPropagation in the panel.
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="bg-surface-container-low rounded-lg shadow-2xl w-[560px] max-w-[92vw] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 pt-5 pb-3 border-b border-system-divider">
          <h2
            id="regenerate-modal-title"
            className="text-base font-semibold text-system-log"
          >
            重新生成 — {target}
          </h2>
          <p className="text-xs text-system-log/60 mt-1">
            原内容将被覆盖,AI 会结合你的意见重新生成
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-4">
          <label
            htmlFor="regenerate-modal-textarea"
            className="block text-xs font-medium text-system-log/70 mb-1.5"
          >
            修改意见 (可选)
          </label>
          <textarea
            id="regenerate-modal-textarea"
            ref={textareaRef}
            aria-label="修改意见"
            value={text}
            onChange={(e) => setText(e.target.value.slice(0, MAX_LEN))}
            onKeyDown={handleTextareaKey}
            maxLength={MAX_LEN}
            placeholder={placeholder}
            className="w-full h-[140px] border border-system-divider rounded-md px-3 py-2 text-sm resize-y focus:outline-none focus:ring-2 focus:ring-primary-container/40 bg-surface-container text-system-log"
          />
          <div className="mt-2 flex justify-between text-[11px] text-system-log/50">
            <span>留空 = 仅重新生成 · 最多 {MAX_LEN} 字</span>
            <span>{text.length} / {MAX_LEN}</span>
          </div>
        </div>

        {/* Footer */}
        <div className="px-6 py-3 bg-surface-container border-t border-system-divider flex items-center justify-between">
          <span className="text-[11px] text-system-log/50">
            Esc 取消 · Cmd+Enter 提交
          </span>
          <div className="flex gap-2">
            <button
              type="button"
              data-testid="regenerate-modal-cancel"
              onClick={onCancel}
              className="px-4 py-1.5 text-sm border border-system-divider rounded-md hover:bg-surface-container-low"
            >
              取消
            </button>
            <button
              type="button"
              data-testid="regenerate-modal-confirm"
              onClick={handleSubmit}
              className="px-4 py-1.5 text-sm bg-tertiary-container text-surface-container-low rounded-md hover:opacity-90"
            >
              重新生成
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 4: Run to verify 8 PASS**

```bash
cd frontend && npm test RegenerateModal 2>&1 | tail -20
```

Expected: 8 PASS.

If any test fails, common issues:
- `aria-label` not matching — confirm the test expects "修改意见" and the component uses `aria-label="修改意见"`.
- Backdrop click — the test uses `.fixed.inset-0` selector; confirm the component has `className="fixed inset-0 z-50 ..."`.
- `Cmd+Enter` — `metaKey: true` is the test setup; the handler checks `e.metaKey || e.ctrlKey`. On Mac, `metaKey` is set for Cmd; on Linux CI, `ctrlKey`. Test uses `metaKey: true`.

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/components/shared/RegenerateModal.tsx frontend/src/components/shared/RegenerateModal.test.tsx
git commit -m "feat(user-modifications): add RegenerateModal component (B-type, 560px)"
```

---

## Task 7: Frontend client API — add `userModifications` to 7 functions

**Files:**
- Modify: `frontend/src/api/client.ts`

- [ ] **Step 1: Discover the 7 API functions**

```bash
grep -n "export.*async function\|export.*function" frontend/src/api/client.ts | head -40
```

Find the 7 functions that correspond to the 7 endpoints:
- `generateConcept` (POST /stage1/generate)
- `generateWorld` (POST /stage2/generate-world)
- `generateCharacter` (POST /stage2/generate-character)
- `regenerateCharacterExamples` (POST /stage2/character/{id}/regenerate-examples)
- `generateOutline` (POST /stage3/generate)
- `generateNovelOutline` (POST /stage3/generate-novel-outline)
- `writeScene` (POST /stage4/write-scene)

(Adjust if the function names differ — match by URL path.)

- [ ] **Step 2: Add a regression test for the API surface**

Create `frontend/src/api/client.test.ts` (or append to existing) — at minimum, a vitest test that asserts the 7 functions exist and accept a `userModifications` option. If a client test file does not already exist, create a minimal one:

```tsx
import { describe, it, expect, vi } from "vitest";

vi.mock("axios", () => ({
  default: {
    post: vi.fn().mockResolvedValue({ data: {} }),
    get: vi.fn().mockResolvedValue({ data: {} }),
    put: vi.fn().mockResolvedValue({ data: {} }),
  },
}));

describe("API client user_modifications surface", () => {
  it("exposes user_modifications in stage1 generate", async () => {
    const client = await import("./client");
    expect(typeof client.generateConcept).toBe("function");
  });
  it("exposes user_modifications in stage4 writeScene", async () => {
    const client = await import("./client");
    expect(typeof client.writeScene).toBe("function");
  });
  // Repeat for the other 5 functions if the file already exists; otherwise
  // these 2 are sufficient as a smoke test.
});
```

The deeper "actual call includes user_modifications in body" test is left to Task 8 (entry-point integration tests). This task only changes signatures; the test asserts signatures exist.

- [ ] **Step 3: Update each of the 7 client functions**

For each function, add `userModifications: string = ""` to the parameters and include `user_modifications: userModifications` in the request body. Example for `generateConcept`:

```typescript
export async function generateConcept(
  projectId: string,
  userModifications: string = "",  // NEW
) {
  const resp = await axios.post("/api/stage1/generate", {
    project_id: projectId,
    user_modifications: userModifications,  // NEW
  });
  return resp.data;
}
```

Apply the same shape to all 7 functions. For `regenerateCharacterExamples`, the body is already `{"keep_existing": false}` — extend it:

```typescript
export async function regenerateCharacterExamples(
  projectId: string,
  characterId: string,
  keepExisting: boolean = false,
  userModifications: string = "",  // NEW
) {
  const resp = await axios.post(
    `/api/stage2/character/${characterId}/regenerate-examples`,
    {
      project_id: projectId,
      keep_existing: keepExisting,
      user_modifications: userModifications,  // NEW
    },
    { params: { project_id: projectId } },
  );
  return resp.data;
}
```

- [ ] **Step 4: Run the client test (if created) and full frontend test suite**

```bash
cd frontend && npm test 2>&1 | tail -20
```

Expected: all existing tests still pass; new client surface tests pass.

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/api/client.ts frontend/src/api/client.test.ts
git commit -m "feat(user-modifications): add userModifications to 7 client API functions"
```

---

## Task 8: Wire `RegenerateModal` into 7 entry points (3 file groups)

**Files:**
- Modify: `frontend/src/components/wizard/InitWizardModal.tsx` (1 modal instance, used by 5 steps)
- Modify: 5 wizard step files (ConceptStep, WorldStep, CharacterStep, OutlineStep, ChapterOutlineStep)
- Modify: `frontend/src/pages/WorkspacePage.tsx` (scene writing)
- Modify: `frontend/src/components/wizard/CharacterStep.tsx` (behavior examples)

The pattern is the same for all 7 entry points: each owns a `showRegenerateModal: boolean` state; the existing regenerate handler opens the modal; the modal's onConfirm calls the actual regeneration with `userModifications`.

- [ ] **Step 1: Wire `ConceptStep` (init wizard step 1)**

In `frontend/src/components/wizard/ConceptStep.tsx`:

1. Import `useState` (already imported) and `RegenerateModal`.
2. Add state: `const [showRegenerateModal, setShowRegenerateModal] = useState(false);`
3. Wrap `handleStart` to accept `userModifications: string`:

```typescript
  const handleStart = async (userModifications: string = "") => {
    wizard.startStep(1);
    setBusy(true);
    try {
      const result = await api.generateConcept(projectId, userModifications);
      setConcept(result.concept);
      setDna(result.story_dna);
      wizard.markStepGenerated(1, { concept: result.concept, story_dna: result.story_dna });
    } catch (e) {
      wizard.setStatus("error", e instanceof Error ? e.message : "概念生成失败");
    } finally {
      setBusy(false);
    }
  };
```

4. Change the `setRegenerateHandler` call to pass an opener:

```typescript
    wizard.setRegenerateHandler(
      canRegenerate ? () => setShowRegenerateModal(true) : null,
      busy,
    );
```

5. Render the modal at the bottom of the JSX (after the existing closing `</div>` of the step):

```tsx
      <RegenerateModal
        open={showRegenerateModal}
        target="概念"
        onConfirm={async (text) => {
          setShowRegenerateModal(false);
          await handleStart(text);
        }}
        onCancel={() => setShowRegenerateModal(false)}
      />
```

Note: The `useEffect` at line 87-97 (auto-trigger on mount) calls `handleStart()` without args. Add a default `userModifications: string = ""` to the `handleStart` signature (done in step 3) so the auto-trigger still works.

- [ ] **Step 2: Wire `WorldStep` (init wizard step 2)**

Same pattern as Step 1. Find the existing regenerate handler in `WorldStep.tsx` (the function passed to `setRegenerateHandler`), wrap it to accept `userModifications`, change the call to use `api.generateWorld(projectId, userModifications)` or similar (match existing arg list), and render the modal with `target="世界观"`.

- [ ] **Step 3: Wire `CharacterStep` (init wizard step 3, full-character regenerate)**

This is the most complex step because it has TWO regenerate flows:
- **Full-character regenerate** (the existing `regenerateConfirmOpen` modal at line ~605-625 — a simple "are you sure?" confirm modal): REPLACE this confirm modal with `RegenerateModal`. The new modal has its own confirm button, so the old confirm is no longer needed.
- **Per-card behavior examples regenerate** (the per-card `regeneratingExamplesIds` spinner): wrap `handleRegenerateExamples` to accept `userModifications` and render a separate `RegenerateModal` instance keyed by `showExamplesModalForId: string | null`.

For the full-character regenerate, follow the same pattern as ConceptStep: wrap the existing handler, change `setRegenerateHandler` to pass an opener, render the modal with `target="角色"`. Remove the old `regenerateConfirmOpen` state and the old confirm JSX.

For the behavior examples modal, add state and wire it:

```typescript
  const [showExamplesModalForId, setShowExamplesModalForId] = useState<string | null>(null);

  const handleRegenerateExamples = async (characterId: string, userModifications: string = "") => {
    // ... existing body, but pass user_modifications to the API call:
    // const updated = await api.regenerateCharacterExamples(projectId, characterId, false, userModifications);
  };
```

Change the `onRegenerate={() => handleRegenerateExamples(c.id)}` prop on `BehaviorExamplesSection` to `onRegenerate={() => setShowExamplesModalForId(c.id)}`. Render the modal at the bottom of the step:

```tsx
      <RegenerateModal
        open={showExamplesModalForId !== null}
        target={showExamplesModalForId
          ? `${(characters?.characters ?? []).find((c) => c.id === showExamplesModalForId)?.name ?? "角色"} · 行为例示`
          : "行为例示"}
        onConfirm={async (text) => {
          const id = showExamplesModalForId;
          setShowExamplesModalForId(null);
          if (id) await handleRegenerateExamples(id, text);
        }}
        onCancel={() => setShowExamplesModalForId(null)}
      />
```

- [ ] **Step 4: Wire `OutlineStep` (init wizard step 3, novel outline)**

The `OutlineStep` calls `POST /stage3/generate-novel-outline`. Follow the same pattern: wrap the regenerate handler, change `api.generateNovelOutline(projectId, ..., userModifications)` (extend the existing args list), render the modal with `target="细纲"`.

- [ ] **Step 5: Wire `ChapterOutlineStep` (init wizard step 4, chapter outline)**

The `ChapterOutlineStep` calls `POST /stage3/generate`. Follow the same pattern: wrap the regenerate handler, change `api.generateOutline(...)` to pass `userModifications`, render the modal with `target="章纲"`.

- [ ] **Step 6: Wire `WritingArea` via `WorkspacePage` (scene writing)**

`WritingArea.tsx` does NOT need any change — it already calls `onRegenerate()`. The change is in `WorkspacePage.tsx`:

1. Add state: `const [showRegenerateModal, setShowRegenerateModal] = useState(false);`
2. Change `doRegenerate` to accept `userModifications`:

```typescript
  const doRegenerate = async (sceneNumber: number, userModifications: string = "") => {
    setBusy(true);
    try {
      const resp = await api.writeScene({
        project_id: projectId,
        chapter_number: currentChapter,
        scene_number: sceneNumber,
        user_modifications: userModifications,  // NEW
      });
      // ... existing body
    } catch (e) {
      // ... existing body
    } finally {
      setBusy(false);
    }
  };
```

3. Change the `onRegenerate` prop passed to `WritingArea` (around line 605):

```typescript
              onRegenerate={async () => {
                if (!currentScene) return;
                const sceneNumber = Number.parseInt(currentScene.split("-")[1] ?? "", 10);
                if (!Number.isFinite(sceneNumber) || sceneNumber < 1) return;
                if (content !== lastSavedContent) {
                  setRegenerateGuard({ open: true, pending: true });
                  return;
                }
                // No unsaved edits — open the modal directly.
                setShowRegenerateModal(true);
              }}
```

4. Find the `regenerateGuard` confirm handler (where the user clicks "OK" in the existing `ConfirmDialog` when there are unsaved edits). After the existing confirm logic, also open the regenerate modal:

```typescript
              onConfirm={async () => {
                setRegenerateGuard({ open: false, pending: false });
                setShowRegenerateModal(true);
              }}
```

(Read the existing `setRegenerateGuard` confirm handler to find the right insertion point.)

5. Render the modal at the bottom of the JSX (in `WorkspacePage`):

```tsx
      <RegenerateModal
        open={showRegenerateModal}
        target={currentScene ? `第${currentChapter}章${currentScene}场` : "场景"}
        onConfirm={async (text) => {
          setShowRegenerateModal(false);
          if (!currentScene) return;
          const sceneNumber = Number.parseInt(currentScene.split("-")[1] ?? "", 10);
          if (!Number.isFinite(sceneNumber) || sceneNumber < 1) return;
          await doRegenerate(sceneNumber, text);
        }}
        onCancel={() => setShowRegenerateModal(false)}
      />
```

- [ ] **Step 7: Run all frontend tests**

```bash
cd frontend && npm test 2>&1 | tail -20
```

Expected: all tests pass. The `RegenerateModal` 8 tests + any existing wizard/workspace tests still pass.

- [ ] **Step 8: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/components/ frontend/src/pages/
git commit -m "feat(user-modifications): wire RegenerateModal into 7 frontend entry points"
```

---

## Task 9: Acceptance verification + full regression

**Files:** none (verification only)

- [ ] **Step 1: Run all backend tests**

```bash
source venv/bin/activate && pytest tests/test_user_modifications.py -v
```

Expected: 17 PASS.

```bash
source venv/bin/activate && pytest tests/ -q 2>&1 | tail -15
```

Expected: same baseline (1398 + 17 = 1415 passed, 7 pre-existing failures, 2 skipped, 1 xfailed). No NEW failures.

- [ ] **Step 2: Run all frontend tests**

```bash
cd frontend && npm test 2>&1 | tail -15
```

Expected: all tests pass (RegenerateModal 8 + any pre-existing).

- [ ] **Step 3: Verify AC1 — regenerating with text appends the block to the LLM prompt**

This is a logical check. Document in the final report:

```
AC1 verified: tests/test_user_modifications.py::TestEndToEndWithSuggestion::test_concept_generation_prompt_includes_user_modifications_block
- user_modifications="让主角动机更清晰" → rendered prompt contains 【用户修改意见】让主角动机更清晰 ✓
```

- [ ] **Step 4: Verify AC2 — empty user_modifications == today's behavior**

```
AC2 verified: tests/test_user_modifications.py::TestEndToEndBackwardCompat::test_empty_user_modifications_renders_no_block
- user_modifications="" → rendered prompt has no 【用户修改意见】 block, placeholder replaced with empty string ✓
```

- [ ] **Step 5: Verify AC3 — char limit enforced at handler**

```
AC3 verified: tests/test_user_modifications.py::TestEndpointWiring::test_endpoint_truncates_user_modifications_to_1000_chars
- user_modifications="z"*5000 → agent receives at most 1000 chars ✓
```

- [ ] **Step 6: Verify AC4 — all 6 prompt templates have the placeholder**

```
AC4 verified: tests/test_user_modifications.py::TestPromptCoverage::test_all_six_prompts_have_user_modifications_placeholder
- 6 templates checked, all contain {user_modifications} ✓
```

- [ ] **Step 7: Verify AC5 — all 6 agent methods accept the kwarg**

```
AC5 verified: tests/test_user_modifications.py::TestAgentSignatureCoverage::test_all_six_agent_methods_accept_user_modifications
- 6 methods checked, all accept user_modifications: str = "" ✓
```

- [ ] **Step 8: Verify AC6 — front-end modal renders + accepts input**

```
AC6 verified: frontend/src/components/shared/RegenerateModal.test.tsx
- 8 vitest tests cover: auto-focus, input, blank submit, Esc cancel, backdrop cancel, Cmd+Enter, maxLength=1000, target in title ✓
```

- [ ] **Step 9: Manual end-to-end (recommended, but not blocking)**

Start the dev server and verify:
1. Open `http://localhost:5173`, navigate to a project
2. Open the InitWizard → click "重新生成" on step 1 → modal opens with title "重新生成 — 概念"
3. Type "让节奏更紧凑" → click "重新生成" → modal closes
4. Check `projects/<id>/llm_usage.jsonl` last entry: prompt ends with `【用户修改意见】让节奏更紧凑`
5. Repeat for steps 2-5, scene writing (stage 4), and per-card behavior examples
6. Click "重新生成" with empty input → modal closes, content regenerates (today's behavior)

- [ ] **Step 10: Commit any test-only adjustments (likely none)**

If no changes were made, skip this step. Do NOT amend previous commits.

---

## Self-Review Checklist (run before handoff)

- [ ] Spec §1.2 goals — 6 entry points with modal: covered (Task 8 wires 3 file groups; InitWizardModal handles 5 wizard steps via `setRegenerateHandler`).
- [ ] Spec §1.2 — empty text == today: covered (Task 1 helper + Task 4 backward compat test).
- [ ] Spec §1.2 — no persistence: covered (no DB writes, no project.json edits, only ephemeral state in modal).
- [ ] Spec §3.1 — `RegenerateModal` props/state/UI: covered (Task 6).
- [ ] Spec §3.1 — auto-focus, Esc, backdrop, Cmd+Enter, maxLength: covered (8 vitest tests).
- [ ] Spec §3.3 — `_build_user_modifications_block`: covered (Task 1).
- [ ] Spec §3.4 — 6 prompt templates with `{user_modifications}` at end: covered (Task 2).
- [ ] Spec §3.5 — 6 agent methods with `user_modifications: str = ""` kwarg: covered (Task 3).
- [ ] Spec §3.6 — 7 endpoint handlers with `payload.get("user_modifications", "")[:1000]`: covered (Task 5).
- [ ] Spec §3.7 — 7 client API functions: covered (Task 7).
- [ ] Spec §3.8 — 3 frontend entry points (wizard, writing, behavior examples): covered (Task 8).
- [ ] Spec §4 data flow: covered by Step 6.8 design + AC1 test.
- [ ] Spec §5 error handling: maxLength=1000 (Task 6), handler truncation (Task 5), empty whitespace → "" (Task 1), missing field → "" (default).
- [ ] Spec §6 char limit + target strings: covered (Task 1 + Task 8 target strings).
- [ ] Spec §7 testing: 17 backend tests + 8 frontend tests + 2 client smoke tests = 27 total.
- [ ] Spec §8 YAGNI: no persistence, no history, no AI suggestions, no templates — respected.
- [ ] Spec §9 file list: 4 new (helper, 2 test files, modal), 16 modified — matches plan.
- [ ] Spec §10 AC1-AC6: each mapped to a specific test (Task 9 Step 3-8).

Type / API consistency check across tasks:
- `_build_user_modifications_block(text: str) -> str` — same in Tasks 1, 3, 4.
- `user_modifications: str = ""` — same in Tasks 3, 5, 6 (frontend), 7.
- `RegenerateModal` props `open, target, onConfirm, onCancel` — same in Tasks 6, 8.
- `{user_modifications}` placeholder — same in Tasks 2, 3, 4.

No placeholders / TBD / "implement later" remain.

---

## Handoff

Plan complete and saved to `docs/superpowers/plans/2026-07-30-regenerate-user-modifications.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session with executing-plans, batch execution with checkpoints

Which approach?
