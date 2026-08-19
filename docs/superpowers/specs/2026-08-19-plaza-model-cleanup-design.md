# Prompt Plaza — Remove `model` Field from Advanced Section

Date: 2026-08-19
Status: Draft (awaiting user review)

## Problem

The Prompt Plaza "Advanced" section shows a `model` input field that has no
effect on downstream scene writing. When users edit it and save, the value
round-trips into `prompt_overrides.json` but is silently ignored by the
writer agent at LLM call time.

### Why the field is dead

`BaseAgent.generate_from_template` (`backend/agents/base_agent.py:231-265`)
loads the merged prompt dict via `load_prompt` → `load_prompt_effective`
→ 3-tier compose (YAML → Global → Project). The result is wrapped in
`PromptTemplate`, whose `self.model` is read but never consulted again.

The LLM call path passes `prompt.max_tokens` and resolves `temperature`
through `_resolve_temperature` (which reads `prompt.temperature`), but
**never** reads `prompt.model`. Model selection is handled by
`ModelRouter.resolve` (`backend/llm/model_router.py:246-284`) from
`config/model_tiers.yaml` `agent_mapping.<agent>.<task>.model` —
not from the prompt dict.

`PromptTemplate.model` (`base_agent.py:24`) is a vestigial attribute.
`PromptTemplate.provider` (`base_agent.py:23`) is similarly dead.

## Goal

Remove the `model` field from the user-facing Plaza flow end-to-end so
the UI does not mislead them into thinking editing it changes routing.

Out of scope (deferred): cleaning `model:` lines from `backend/prompts/*.yaml`,
removing the dead `PromptTemplate.model` / `.provider` attributes, and
migrating historical `model` entries from existing override JSONs.

## Design

### Frontend changes

| File | Change |
|------|--------|
| `frontend/src/components/home/promptPlaza/AdvancedSection.tsx` | Remove `model` and `onModelChange` from props; delete the `<label>model</label>` + `<input data-testid="adv-model">` block. |
| `frontend/src/components/home/promptPlaza/PromptEditPanel.tsx` | Remove `useState("")` for `model`; remove `setModel(...)` from the detail-change effect; drop `model` from the `onSave` payload; drop `model !== baseModel` from the dirty check. |
| `frontend/src/api/promptPlaza.ts` | Drop `model?: string` from the `PromptOverridePayload` interface. |

### Backend changes

| File | Change |
|------|--------|
| `backend/api/prompt_plaza.py` | Drop `model: Optional[str] = None` from `PromptOverridePayload` (line 31). `extra="forbid"` then rejects any PUT carrying `model` with a 422. |
| `backend/api/prompt_defaults.py` | Same change (line 35). |

### Untouched (intentional)

- `backend/services/prompt_override_store.py`,
  `backend/services/global_prompt_override_store.py` — these stores do
  generic key-based read/write; nothing references `model` specifically.
  No edits needed.
- `backend/prompts/*.yaml` — read-only factory defaults; out of scope.
  Harmless: the `model:` line is ignored at runtime.
- `backend/agents/base_agent.py` — `PromptTemplate.model` / `.provider`
  are dead but removing them is a separate cleanup task.

## Data Flow

### Write path

```
Old:  PUT {model, temperature, max_tokens, ...}
        → PromptOverridePayload.model accepted
        → overrides.json gains "model" key

New:  PUT {model, ...}                  → 422 (extra="forbid")
      PUT {temperature, max_tokens, ...} → normal save
```

### Read path (unchanged)

`get_override_only` / `get_effective` continue to merge arbitrary dict
keys. Historical overrides that contain `model` will still appear in
the `effective` view (as part of `Record<string, unknown>`), but the
Plaza UI no longer renders an input for it. The field becomes
read-only leftover data — benign because the call chain never reads it.

### Existing data

Per user decision (clarifying question 2): no migration script.
- `prompt_override_store._pruned_override` (`prompt_override_store.py:162-172`)
  drops fields only when their value equals the YAML default. Values
  that differ from `model: deepseek-chat` (e.g. `"MiniMax-M3"`) will
  persist in JSON until the user explicitly edits or resets that prompt.
- The persisted key is dead data; the LLM call chain never reads it.
- Future cleanup (separate spec) can sweep historical entries.

## Error Handling

- A client sending `model` in a PUT body gets Pydantic 422 with FastAPI's
  default validation detail. This matches what other Pydantic-rejected
  fields return; an envelope-style 400 is a possible follow-up but not
  in scope here.
- JSON parsing of legacy override files is unaffected — `json.load`
  ignores unknown keys.

## Testing

### Frontend (`PromptEditPanel.test.tsx`)

- Remove `model: "deepseek-chat"` from the test fixture (lines 12, 22).
- Add a new test asserting the `model` input is no longer rendered:
  ```ts
  it("does not render the model input in Advanced", () => {
    render(<PromptEditPanel detail={DETAIL} ... />);
    // Open the Advanced section
    fireEvent.click(screen.getByTestId("advanced-toggle"));
    expect(screen.queryByTestId("adv-model")).toBeNull();
  });
  ```
- Existing dirty-check and reset tests should continue to pass without
  modification (the dirty check no longer references `model`).

### Backend

- Locate existing tests for `/api/projects/{id}/prompts/{name}` and
  `/api/prompts/defaults/{name}` PUT routes (likely under
  `tests/test_api_prompts.py` or similar; verify during implementation).
- Add a test asserting that `PUT {model: "MiniMax-M3"}` returns 422.

### Manual verification

- Open Plaza in browser, expand Advanced section for `scene_writing`,
  confirm no `model` input is rendered.
- Save an edit (e.g. change system prompt); reload page; confirm
  override persists and `effective` no longer carries a stale `model`
  edit affordance.

## Files Touched (summary)

```
frontend/src/components/home/promptPlaza/AdvancedSection.tsx
frontend/src/components/home/promptPlaza/PromptEditPanel.tsx
frontend/src/api/promptPlaza.ts
frontend/src/test/promptPlaza/PromptEditPanel.test.tsx
backend/api/prompt_plaza.py
backend/api/prompt_defaults.py
tests/test_api_prompts.py          # new test for 422
```

7 files total. No data migration; no schema migration; no new
dependencies.

## Risks

- **None for behavior.** The `model` field has no observable effect on
  scene writing today; removing the input changes nothing about how the
  system routes or generates content.
- **Slight surface change for users who were experimentally typing into
  the field.** They will see the input disappear. No data loss: the
  values they typed are already in JSON and will remain there
  (harmless) until they reset that prompt or run a future cleanup.