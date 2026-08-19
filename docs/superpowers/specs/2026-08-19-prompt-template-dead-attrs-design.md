# PromptTemplate — Remove Dead `name` / `provider` / `model` Attributes

Date: 2026-08-19
Status: Draft (awaiting user review)

## Problem

`PromptTemplate.__init__` (`backend/agents/base_agent.py:20-29`) reads three
attributes from the YAML prompt dict that are never consulted at runtime:

- `self.name: str = data.get("name", "")` (line 22)
- `self.provider: str = data.get("provider", settings.llm_provider)` (line 23)
- `self.model: str = data.get("model", settings.llm_model)` (line 24)

The call chain for scene writing and other LLM tasks reads
`prompt.system_prompt`, `prompt.user_prompt_template`, `prompt.output_format`
(via `is_json_mode`), `prompt.max_tokens`, and `prompt.temperature` (via
`_resolve_temperature`). It never reads `prompt.name`, `prompt.provider`, or
`prompt.model`.

This is leftover from earlier code paths. Model selection is handled by
`ModelRouter.resolve` (`backend/llm/model_router.py:246-284`) reading
`config/model_tiers.yaml` `agent_mapping.<agent>.<task>.model`, not from
the prompt dict.

`BaseAgent.provider` (`base_agent.py:67`) is a property that returns the
live `BaseLLMProvider` — completely separate from `PromptTemplate.provider`,
which only stored a string.

## Goal

Remove the three dead attributes from `PromptTemplate.__init__` and add a
focused test that catches any regression re-introducing them.

Out of scope (deferred, separate specs):
- Removing `model:` lines from `backend/prompts/*.yaml` (11 files)
- Migrating historical `model` keys out of `prompt_overrides.json`

## Design

### Files to modify

| File | Change |
|------|--------|
| `backend/agents/base_agent.py:20-29` | Remove lines 22, 23, 24 (`self.name`, `self.provider`, `self.model` assignments). `settings` import remains in use by lines 25–26 (`temperature` / `max_tokens` defaults). |
| `tests/test_prompt_template_attrs.py` | New file: focused test asserting the three attributes do not exist and the live attributes do. |

### After the change, `PromptTemplate.__init__` reads:

```python
def __init__(self, data: dict):
    self.temperature: float = data.get("temperature", settings.llm_temperature)
    self.max_tokens: int = data.get("max_tokens", settings.llm_max_tokens)
    self.system_prompt: str = data.get("system_prompt", "")
    self.user_prompt_template: str = data.get("user_prompt_template", "")
    self.output_format: dict = data.get("output_format", {})
```

The dict keys `name`, `provider`, `model` from YAML are silently ignored —
no other code path reads them.

### New test file

`tests/test_prompt_template_attrs.py`:

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

The "live attributes still present" class is defensive — it catches a
regression where someone removes a *live* attribute by mistake while
cleaning the dead ones.

## Data Flow

### Read path (unchanged)

`PromptTemplate(data)` after the change still exposes:
- `temperature` (read by `_resolve_temperature`)
- `max_tokens` (read by `generate`, `generate_with_tier`, `generate_stream`)
- `system_prompt`, `user_prompt_template` (read by `format_system`, `format_user`)
- `output_format` (read by `is_json_mode` property)

The `name` / `provider` / `model` keys in the input dict are silently
dropped. Existing callers that pass these keys (e.g. the YAML files
themselves) continue to work — the keys just don't surface as attributes.

### Production callers (verified unaffected)

- `BaseAgent.load_prompt` (`base_agent.py:147-176`) returns a
  `PromptTemplate(data)` from the 3-tier merge. Reads only live
  attributes downstream.
- `BaseAgent._load_prompt_from_yaml` (line 188-189) — also returns
  `PromptTemplate(data)`; same behavior.
- No agent subclass reads `prompt.name` / `prompt.model` /
  `prompt.provider` (verified by grep across `backend/agents/` and
  `tests/`).

### Test callers (verified unaffected)

- `tests/test_user_modifications.py:36,49` — constructs
  `PromptTemplate({"name": ..., "user_prompt_template": ...})` and calls
  `format_user()`. Doesn't access `.name`.
- `tests/test_genre_temperature.py:204` — constructs `PromptTemplate({...})`
  with `temperature: None` and stubs `agent.load_prompt`. Doesn't access
  the removed attributes.

## Error Handling

- `PromptTemplate({"model": "x"})` previously set `self.model = "x"`; now
  silently ignores the key. **No `AttributeError`** — the attribute simply
  doesn't exist (verified via `hasattr(t, "model") == False`).
- If a future code path *does* need `prompt.model`, it will fail loudly
  with `AttributeError` — which is what we want (forces an explicit
  decision instead of silently using dead data).

## Testing

| Test class | Asserts |
|------------|---------|
| `TestDeadAttributesRemoved` | `hasattr(t, "model")`, `hasattr(t, "provider")`, `hasattr(t, "name")` are all `False` after constructing a `PromptTemplate` with those keys. |
| `TestLiveAttributesStillPresent` | `temperature`, `max_tokens`, `system_prompt`, `user_prompt_template`, `output_format`, and `is_json_mode` (property) still return the expected values. |

### Regression coverage

The existing tests that construct `PromptTemplate` directly
(`test_user_modifications.py`, `test_genre_temperature.py`) keep passing
because they don't read the removed attributes.

### Manual verification

- `pytest tests/test_prompt_template_attrs.py -v` — passes
- `pytest tests/test_user_modifications.py tests/test_genre_temperature.py -v`
  — passes (no regression in callers)
- Full backend suite: `pytest tests/` — passes

## Files Touched (summary)

```
backend/agents/base_agent.py            # remove 3 lines
tests/test_prompt_template_attrs.py     # new file, ~30 lines
```

2 files, 1 commit. No data migration; no schema change; no new dependencies.

## Risks

- **None for behavior.** The three attributes have no observable effect
  on scene writing today; removing them changes nothing about how the
  system routes or generates content.
- **Slight surface change for any external code that reads
  `prompt.model` / `prompt.provider` / `prompt.name`.** Internal grep
  found none; external code outside this repo would need to use
  `settings.llm_model` / `settings.llm_provider` instead. Worth flagging
  if the project ships as a library — currently it does not.