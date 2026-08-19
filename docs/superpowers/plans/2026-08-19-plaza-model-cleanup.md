# Prompt Plaza — Remove `model` Field Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the dead `model` field from the Prompt Plaza "Advanced" section end-to-end so users are no longer misled into thinking editing it changes scene-writing routing.

**Architecture:** Three discrete edits — backend Pydantic payloads reject `model` (extra="forbid" → 422), frontend API type drops the field, frontend UI removes the input and any state/payload references. Existing override JSON entries with `model` are left untouched (harmless dead data).

**Tech Stack:** Python 3 / FastAPI / Pydantic, React 18 / TypeScript / Vitest, pytest.

---

## Task 1: Backend — `/api/projects/{id}/prompts/{name}` rejects `model` in PUT (422)

**Files:**
- Modify: `tests/test_prompt_plaza_api.py` (add a test in `TestPutOverride`)
- Modify: `backend/api/prompt_plaza.py:26-36` (`PromptOverridePayload`)

- [ ] **Step 1: Add a failing test in `TestPutOverride`**

Open `tests/test_prompt_plaza_api.py` and add this test inside the existing `class TestPutOverride:` (after the `test_404_when_name_not_found` test, before the next class):

```python
    def test_put_rejects_model_field_with_422(self, client, project_id):
        """The `model` field is a dead UI artifact — backend must reject it."""
        resp = client.put(
            f"/api/projects/{project_id}/prompts/scene_writing",
            json={"system_prompt": "x", "model": "MiniMax-M3"},
        )
        assert resp.status_code == 422
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_prompt_plaza_api.py::TestPutOverride::test_put_rejects_model_field_with_422 -v`
Expected: FAIL with `assert 200 == 422` (the current Pydantic model still accepts `model`).

- [ ] **Step 3: Drop the `model` field from the Pydantic payload**

Edit `backend/api/prompt_plaza.py:26-36`. Replace the `PromptOverridePayload` class with:

```python
class PromptOverridePayload(BaseModel):
    """Fields a user can override. extra='forbid' rejects _modified_at etc."""

    system_prompt: Optional[str] = None
    user_prompt_template: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    output_format: Optional[Dict[str, Any]] = None

    model_config = ConfigDict(extra="forbid")
```

(Removed line: `model: Optional[str] = None` at line 31.)

- [ ] **Step 4: Re-run the test and verify it passes**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_prompt_plaza_api.py::TestPutOverride::test_put_rejects_model_field_with_422 -v`
Expected: PASS.

- [ ] **Step 5: Run the full plaza API test file to confirm no regression**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_prompt_plaza_api.py -v`
Expected: All tests pass (the new test plus all pre-existing tests).

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add tests/test_prompt_plaza_api.py backend/api/prompt_plaza.py
git commit -m "feat(api): reject dead model field in project prompt overrides

The model field in PromptOverridePayload was never read by the writer
agent — routing uses config/model_tiers.yaml agent_mapping. Drop the
field so extra='forbid' returns 422 on PUT, preventing users from
thinking edits affect scene-writing behavior.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 2: Backend — `/api/prompts/defaults/{name}` rejects `model` in PUT (422)

**Files:**
- Modify: `tests/test_prompt_defaults_api.py` (add a test in `TestPutOverride`)
- Modify: `backend/api/prompt_defaults.py:30-40` (`PromptOverridePayload`)

- [ ] **Step 1: Add a failing test in `TestPutOverride`**

Open `tests/test_prompt_defaults_api.py` and add this test inside `class TestPutOverride:` (after `test_404_when_name_not_found`, near the end of the class):

```python
    def test_put_rejects_model_field_with_422(self, client):
        """The `model` field is a dead UI artifact — backend must reject it."""
        resp = client.put(
            "/api/prompts/defaults/scene_writing",
            json={"system_prompt": "x", "model": "MiniMax-M3"},
        )
        assert resp.status_code == 422
```

The `scene_writing` fixture is created by the autouse `patch_store_paths` + `real_prompts_dir` fixtures at the top of the file, so this name is valid without additional setup.

- [ ] **Step 2: Run the new test and verify it fails**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_prompt_defaults_api.py::TestPutOverride::test_put_rejects_model_field_with_422 -v`
Expected: FAIL with `assert 200 == 422`.

- [ ] **Step 3: Drop the `model` field from the Pydantic payload**

Edit `backend/api/prompt_defaults.py:30-40`. Replace the `PromptOverridePayload` class with:

```python
class PromptOverridePayload(BaseModel):
    """Fields a user can override. extra='forbid' rejects _modified_at etc."""

    system_prompt: Optional[str] = None
    user_prompt_template: Optional[str] = None
    temperature: Optional[float] = None
    max_tokens: Optional[int] = None
    output_format: Optional[Dict[str, Any]] = None

    model_config = ConfigDict(extra="forbid")
```

(Removed line: `model: Optional[str] = None` at line 35.)

- [ ] **Step 4: Re-run the test and verify it passes**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_prompt_defaults_api.py::TestPutOverride::test_put_rejects_model_field_with_422 -v`
Expected: PASS.

- [ ] **Step 5: Run the full defaults API test file to confirm no regression**

Run: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_prompt_defaults_api.py -v`
Expected: All tests pass.

- [ ] **Step 6: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add tests/test_prompt_defaults_api.py backend/api/prompt_defaults.py
git commit -m "feat(api): reject dead model field in global prompt overrides

Mirror the per-project plaza change: the model field is unused by
the writer agent, so the global defaults endpoint must reject it too.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 3: Frontend — drop `model` from `PromptOverridePayload` type

**Files:**
- Modify: `frontend/src/api/promptPlaza.ts:23-30` (`PromptOverridePayload` interface)

- [ ] **Step 1: Edit the interface**

Replace the `PromptOverridePayload` interface in `frontend/src/api/promptPlaza.ts:23-30`:

```typescript
export interface PromptOverridePayload {
  system_prompt?: string;
  user_prompt_template?: string;
  temperature?: number;
  max_tokens?: number;
  output_format?: Record<string, unknown>;
}
```

(Removed line: `model?: string;` at line 26.)

This is a type-only change. TypeScript will surface any downstream usage in subsequent tasks (4 and 5) and during frontend test runs.

- [ ] **Step 2: Verify TypeScript compiles cleanly**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx tsc --noEmit -p tsconfig.json 2>&1 | head -40`
Expected: No errors mentioning `model` in `promptPlaza.ts` consumers. (Pre-existing errors in unrelated files are acceptable — focus only on whether the `model`-related removal introduces new errors.)

- [ ] **Step 3: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/api/promptPlaza.ts
git commit -m "refactor(frontend): drop dead model field from plaza payload type

Type-only change to keep the API type aligned with the backend
PromptOverridePayload after model field removal. Consumers will be
cleaned up in subsequent commits.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 4: Frontend — remove `model` input from AdvancedSection

**Files:**
- Modify: `frontend/src/components/home/promptPlaza/AdvancedSection.tsx`
- Modify: `frontend/src/test/promptPlaza/PromptEditPanel.test.tsx`

- [ ] **Step 1: Add a failing test asserting the `model` input is absent**

Open `frontend/src/test/promptPlaza/PromptEditPanel.test.tsx`. Add a new `it(...)` block inside the existing `describe("PromptEditPanel", () => { ... })` — place it after `it("calls onReset when reset button is clicked", ...)`:

```typescript
  it("does not render a model input in the Advanced section", () => {
    render(<PromptEditPanel detail={DETAIL} loading={false} error={null} onSave={vi.fn()} onReset={vi.fn()} onClose={vi.fn()} />);
    // Open the Advanced section so its body is in the DOM
    fireEvent.click(screen.getByTestId("advanced-toggle"));
    expect(screen.queryByTestId("adv-model")).toBeNull();
  });
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npm test -- promptPlaza/PromptEditPanel.test.tsx -t "does not render a model input"`
Expected: FAIL with `expect(screen.queryByTestId("adv-model")).toBeNull()` — the input currently exists, so the assertion fails.

- [ ] **Step 3: Remove the `model` input and related props from AdvancedSection**

Edit `frontend/src/components/home/promptPlaza/AdvancedSection.tsx`. Replace the entire file content with:

```tsx
import { useState } from "react";

interface Props {
  temperature: number;
  maxTokens: number;
  outputFormatJson: string;
  onTemperatureChange: (v: number) => void;
  onMaxTokensChange: (v: number) => void;
  onOutputFormatChange: (v: string) => void;
}

export default function AdvancedSection({
  temperature, maxTokens, outputFormatJson,
  onTemperatureChange, onMaxTokensChange, onOutputFormatChange,
}: Props) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border-t border-outline-variant">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        data-testid="advanced-toggle"
        className="w-full px-3 py-2 flex items-center justify-between text-sm text-system-log hover:text-primary"
      >
        <span>高级</span>
        <span className="material-symbols-outlined text-base">
          {open ? "expand_less" : "expand_more"}
        </span>
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-3" data-testid="advanced-body">
          <div>
            <label className="block text-xs font-label-mono text-system-log mb-1">
              temperature: {temperature.toFixed(2)}
            </label>
            <input
              type="range"
              min="0" max="2" step="0.05"
              value={temperature}
              onChange={(e) => onTemperatureChange(parseFloat(e.target.value))}
              data-testid="adv-temperature"
              className="w-full"
            />
          </div>
          <div>
            <label className="block text-xs font-label-mono text-system-log mb-1">max_tokens</label>
            <input
              type="number"
              min="1" max="32768"
              value={maxTokens}
              onChange={(e) => onMaxTokensChange(parseInt(e.target.value, 10) || 0)}
              data-testid="adv-max-tokens"
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-label-mono text-system-log mb-1">output_format (JSON)</label>
            <textarea
              value={outputFormatJson}
              onChange={(e) => onOutputFormatChange(e.target.value)}
              data-testid="adv-output-format"
              rows={3}
              className="w-full bg-surface-container border border-outline-variant rounded px-2 py-1 text-xs font-mono resize-y"
            />
          </div>
        </div>
      )}
    </div>
  );
}
```

Changes: removed `model`, `onModelChange` from `Props`; removed the `<div>` block containing `<label>model</label>` and `<input data-testid="adv-model">`; removed `model`, `onModelChange` from the destructure and prop forwarding.

- [ ] **Step 4: Re-run the new test and verify it passes**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npm test -- promptPlaza/PromptEditPanel.test.tsx -t "does not render a model input"`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/components/home/promptPlaza/AdvancedSection.tsx frontend/src/test/promptPlaza/PromptEditPanel.test.tsx
git commit -m "refactor(frontend): remove model input from plaza advanced section

The model field is a dead UI artifact — it had no effect on LLM
routing. Drop the input, prop, and label so users are no longer
misled into editing it.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 5: Frontend — remove `model` state from PromptEditPanel + clean fixture

**Files:**
- Modify: `frontend/src/components/home/promptPlaza/PromptEditPanel.tsx`
- Modify: `frontend/src/test/promptPlaza/PromptEditPanel.test.tsx` (fixture + new test)

- [ ] **Step 1: Add a failing test asserting `onSave` payload lacks `model`**

Open `frontend/src/test/promptPlaza/PromptEditPanel.test.tsx`. Add a new `it(...)` block after `it("does not render a model input in the Advanced section", ...)`:

```typescript
  it("onSave payload does not include a model field", () => {
    const onSave = vi.fn();
    render(<PromptEditPanel detail={DETAIL} loading={false} error={null} onSave={onSave} onReset={vi.fn()} onClose={vi.fn()} />);
    fireEvent.change(screen.getByTestId("edit-system"), { target: { value: "NEW sys" } });
    fireEvent.click(screen.getByTestId("save-button"));
    expect(onSave).toHaveBeenCalledTimes(1);
    const payload = onSave.mock.calls[0][0];
    expect(payload).not.toHaveProperty("model");
  });
```

- [ ] **Step 2: Run the new test and verify it fails**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npm test -- promptPlaza/PromptEditPanel.test.tsx -t "onSave payload does not include a model field"`
Expected: FAIL — current implementation includes `model` in the payload, so `not.toHaveProperty("model")` fails.

- [ ] **Step 3: Remove `model` state, dirty check, and onSave payload field**

Edit `frontend/src/components/home/promptPlaza/PromptEditPanel.tsx`. Make the following changes:

(a) In the `Props` interface (lines 10-17), drop the `model?: string;` line:

```typescript
interface Props {
  detail: PromptDetail | null;
  loading: boolean;
  error: string | null;
  onSave: (payload: {
    system_prompt?: string;
    user_prompt_template?: string;
    temperature?: number;
    max_tokens?: number;
    output_format?: Record<string, unknown>;
  }) => void;
  onReset: () => void;
  onClose: () => void;
}
```

(b) In the component body (lines 33-38), drop the `model` state line:

```typescript
  const [systemPrompt, setSystemPrompt] = useState("");
  const [userTemplate, setUserTemplate] = useState("");
  const [temperature, setTemperature] = useState(0.9);
  const [maxTokens, setMaxTokens] = useState(1000);
  const [outputFormatJson, setOutputFormatJson] = useState("{}");
```

(c) In the detail-change `useEffect` (lines 46-55), drop the `setModel(...)` line:

```typescript
  useEffect(() => {
    if (!detail) return;
    setSystemPrompt(getEffectiveString(detail, "system_prompt"));
    setUserTemplate(getEffectiveString(detail, "user_prompt_template"));
    setTemperature(getEffectiveNumber(detail, "temperature", 0.9));
    setMaxTokens(getEffectiveNumber(detail, "max_tokens", 1000));
    const of = (detail.effective as Record<string, unknown>).output_format;
    setOutputFormatJson(of ? JSON.stringify(of) : "{}");
  }, [detail]);
```

(d) In the `dirty` useMemo (lines 57-73), drop the `setModel`/`baseModel` lines and the `model !== baseModel` clause:

```typescript
  const dirty = useMemo(() => {
    if (!detail) return false;
    const baseSystem = getEffectiveString(detail, "system_prompt");
    const baseUser = getEffectiveString(detail, "user_prompt_template");
    const baseTemp = getEffectiveNumber(detail, "temperature", 0.9);
    const baseMax = getEffectiveNumber(detail, "max_tokens", 1000);
    const baseOf = JSON.stringify((detail.effective as Record<string, unknown>).output_format ?? {});
    return (
      systemPrompt !== baseSystem ||
      userTemplate !== baseUser ||
      temperature !== baseTemp ||
      maxTokens !== baseMax ||
      outputFormatJson !== baseOf
    );
  }, [detail, systemPrompt, userTemplate, temperature, maxTokens, outputFormatJson]);
```

(e) In `handleSave` (lines 97-112), drop the `model,` line from the payload:

```typescript
  const handleSave = () => {
    let parsed: Record<string, unknown> | undefined;
    try {
      parsed = JSON.parse(outputFormatJson) as Record<string, unknown>;
    } catch {
      parsed = undefined;
    }
    onSave({
      system_prompt: systemPrompt,
      user_prompt_template: userTemplate,
      temperature,
      max_tokens: maxTokens,
      output_format: parsed,
    });
  };
```

(f) In the `<AdvancedSection ... />` JSX (lines 165-174), drop the `model={model}` and `onModelChange={setModel}` props:

```tsx
        <AdvancedSection
          temperature={temperature}
          maxTokens={maxTokens}
          outputFormatJson={outputFormatJson}
          onTemperatureChange={setTemperature}
          onMaxTokensChange={setMaxTokens}
          onOutputFormatChange={setOutputFormatJson}
        />
```

- [ ] **Step 4: Remove `model` from the test fixture**

Edit `frontend/src/test/promptPlaza/PromptEditPanel.test.tsx`. In the `DETAIL` constant (lines 6-27), remove the `model: "deepseek-chat",` lines from both `builtin_yaml` (line 12) and `effective` (line 22):

```typescript
const DETAIL: PromptDetail = {
  name: "scene_writing",
  builtin_yaml: {
    name: "scene_writing",
    system_prompt: "default sys",
    user_prompt_template: "default user {var}",
    temperature: 0.9,
    max_tokens: 1000,
    output_format: { type: "json" },
  },
  override: null,
  effective: {
    name: "scene_writing",
    system_prompt: "default sys",
    user_prompt_template: "default user {var}",
    temperature: 0.9,
    max_tokens: 1000,
    output_format: { type: "json" },
  },
};
```

- [ ] **Step 5: Re-run the new test and verify it passes**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npm test -- promptPlaza/PromptEditPanel.test.tsx -t "onSave payload does not include a model field"`
Expected: PASS.

- [ ] **Step 6: Run the entire plaza test suite to confirm no regression**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npm test -- promptPlaza/`
Expected: All tests pass (including the two new tests, the existing dirty-check tests, and the existing tests in `PromptPlazaModal.test.tsx` / `PromptListPanel.test.tsx`).

- [ ] **Step 7: Run TypeScript check to confirm no compile errors**

Run: `cd /Users/longsa/Codes/storyForge2/frontend && npx tsc --noEmit -p tsconfig.json 2>&1 | head -40`
Expected: No errors mentioning `model` in plaza files.

- [ ] **Step 8: Commit**

```bash
cd /Users/longsa/Codes/storyForge2
git add frontend/src/components/home/promptPlaza/PromptEditPanel.tsx frontend/src/test/promptPlaza/PromptEditPanel.test.tsx
git commit -m "refactor(frontend): drop model state from PromptEditPanel

Remove the unused model state, dirty-check clause, and onSave payload
field so the panel no longer reads or sends the dead field. Clean the
test fixture to match.

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Self-Review Checklist (run after implementation)

- [ ] Backend tests: `cd /Users/longsa/Codes/storyForge2 && source venv/bin/activate && pytest tests/test_prompt_plaza_api.py tests/test_prompt_defaults_api.py -v` — all pass
- [ ] Frontend tests: `cd /Users/longsa/Codes/storyForge2/frontend && npm test -- promptPlaza/` — all pass
- [ ] Manual UI check: open Plaza, expand Advanced section, confirm no `model` input is visible
- [ ] Manual API check: `curl -X PUT http://127.0.0.1:8000/api/projects/proj_test/prompts/scene_writing -H "Content-Type: application/json" -d '{"model": "x"}'` — expect 422
- [ ] Git log: 6 commits total (Tasks 1, 2, 3, 4, 5, [optionally a final summary if desired])