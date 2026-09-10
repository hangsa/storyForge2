# Rename `three_b_decompose` → `firstness_decompose` Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rename one prompt identifier — `three_b_decompose` → `firstness_decompose` — by updating the YAML file path, the YAML `name:` field, the engine constant, and every test reference that points at it. Sibling `three_b_*` prompts stay. Historical docs stay.

**Architecture:** TDD refactor. (1) Edit the test file first so it expresses the desired new state — run tests and confirm RED. (2) Apply the rename to the YAML file (git mv), update its `name:` field, update the engine constant — run tests and confirm GREEN. (3) Run wider regression and grep verification.

**Tech Stack:** Python · pytest · YAML · git mv (preserves history).

**Branch:** `nebula` (current). No worktree — single-file rename, no isolation needed.

**Spec:** `docs/superpowers/specs/2026-09-10-three-b-decompose-rename-design.md` (commit `14e93d2`).

---

## File map

| File | Change | Responsibility |
|---|---|---|
| `backend/prompts/creative/three_b_decompose.yaml` | Rename → `firstness_decompose.yaml` | The prompt itself; only its path + name field change |
| `backend/creative_os/three_b_engine.py` | Edit line 50 | Engine constant value follows the prompt name |
| `backend/tests/test_three_b_yaml.py` | Edit 9 sites (L6, L40, L313, L316, L318, L322, L325, L327, L394) | Test references must point at the new name |
| `docs/superpowers/{specs,plans}/*.md` | NONE | Frozen historical records (per user decision) |
| Sibling prompts (`three_b_adaptive_diverge.yaml`, `three_b_commit.yaml`, `three_b_follow_up.yaml`) | NONE | Out of scope (user decision) |
| Engine module name `three_b_engine.py` / `three_b_routes.py` / state file `three_b_state.json` | NONE | Out of scope (user decision) |

---

### Task 1: Update test references (TDD red)

**Files:**
- Modify: `backend/tests/test_three_b_yaml.py` (L6, L40, L313, L316, L318, L322, L325, L327, L394)

- [ ] **Step 1: Edit the module docstring bullet (L6)**

In `backend/tests/test_three_b_yaml.py`, change L6 from:

```
  - three_b_decompose           (Stage 1 → 2: 5-dimension decomposition)
```

to:

```
  - firstness_decompose         (Stage 1 → 2: 5-dimension decomposition)
```

(Three of the four lines in this docstring are NOT touched — they describe sibling prompts that keep their names.)

- [ ] **Step 2: Edit the EXPECTED_NAMES tuple (L40)**

In `backend/tests/test_three_b_yaml.py`, change L40 from:

```python
EXPECTED_NAMES = (
    "three_b_decompose",
    "three_b_follow_up",
    "three_b_adaptive_diverge",
    "three_b_commit",
)
```

to:

```python
EXPECTED_NAMES = (
    "firstness_decompose",
    "three_b_follow_up",
    "three_b_adaptive_diverge",
    "three_b_commit",
)
```

- [ ] **Step 3: Edit the dedicated-section comment header (L313)**

In `backend/tests/test_three_b_yaml.py`, change L313 from:

```
# --- three_b_decompose (Stage 1→2 prompt, added in rewrite Task 10) -----------
```

to:

```
# --- firstness_decompose (Stage 1→2 prompt, added in rewrite Task 10) ---------
```

- [ ] **Step 4: Rename `test_three_b_decompose_yaml_exists` and update its Path (L316, L318)**

In `backend/tests/test_three_b_yaml.py`, change L316–L319 from:

```python
def test_three_b_decompose_yaml_exists():
    from pathlib import Path
    p = Path("backend/prompts/creative/three_b_decompose.yaml")
    assert p.exists(), f"{p} 不存在"
```

to:

```python
def test_firstness_decompose_yaml_exists():
    from pathlib import Path
    p = Path("backend/prompts/creative/firstness_decompose.yaml")
    assert p.exists(), f"{p} 不存在"
```

- [ ] **Step 5: Rename `test_three_b_decompose_yaml_schema` and update Path + name assertion (L322, L325, L327)**

In `backend/tests/test_three_b_yaml.py`, change L322–L327 from:

```python
def test_three_b_decompose_yaml_schema():
    import yaml
    from pathlib import Path
    p = Path("backend/prompts/creative/three_b_decompose.yaml")
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    assert data["name"] == "three_b_decompose"
```

to:

```python
def test_firstness_decompose_yaml_schema():
    import yaml
    from pathlib import Path
    p = Path("backend/prompts/creative/firstness_decompose.yaml")
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    assert data["name"] == "firstness_decompose"
```

- [ ] **Step 6: Edit the `test_all_v2_yamls_in_creative_dir` expected set (L394)**

In `backend/tests/test_three_b_yaml.py`, change L394 from:

```python
    expected = {"three_b_decompose", "three_b_follow_up", "three_b_adaptive_diverge", "three_b_commit"}
```

to:

```python
    expected = {"firstness_decompose", "three_b_follow_up", "three_b_adaptive_diverge", "three_b_commit"}
```

- [ ] **Step 7: Run the test file and confirm RED**

Run: `cd /Users/longsa/Codes/nebula && pytest backend/tests/test_three_b_yaml.py -v`

Expected: multiple failures, including (but not limited to):
- `test_firstness_decompose_yaml_exists` — `AssertionError: backend/prompts/creative/firstness_decompose.yaml 不存在`
- `test_firstness_decompose_yaml_schema` — `FileNotFoundError` on `p.read_text(...)`
- `test_yaml_file_exists[firstness_decompose]` — same FileNotFoundError
- `test_yaml_parses_with_expected_name[firstness_decompose]` — same
- `test_plaza_*` — will show `firstness_decompose` missing from discovered stems
- `test_load_prompt_effective_*[firstness_decompose]` — `FileNotFoundError` from `load_prompt_effective("firstness_decompose")`

Acceptance: at least 4 distinct failures, all attributable to the new identifier not yet existing on disk. If you see unrelated failures, stop and investigate before proceeding.

- [ ] **Step 8: Do NOT commit yet — tests must be red until Task 2 makes them green**

---

### Task 2: Apply the rename to source files (TDD green)

**Files:**
- Rename: `backend/prompts/creative/three_b_decompose.yaml` → `backend/prompts/creative/firstness_decompose.yaml` (use `git mv` to preserve history)
- Modify: `backend/prompts/creative/firstness_decompose.yaml` (line 1, the `name:` field)
- Modify: `backend/creative_os/three_b_engine.py` (line 50, the `DECOMPOSE_PROMPT` constant)

- [ ] **Step 1: `git mv` the YAML file**

Run: `cd /Users/longsa/Codes/nebula && git mv backend/prompts/creative/three_b_decompose.yaml backend/prompts/creative/firstness_decompose.yaml`

Verify: `ls backend/prompts/creative/ | grep -E '(three_b_decompose|firstness_decompose)'` — only `firstness_decompose.yaml` should appear; `three_b_decompose.yaml` should be gone.

- [ ] **Step 2: Update the `name:` field inside the renamed YAML**

In `backend/prompts/creative/firstness_decompose.yaml`, change line 1 from:

```yaml
name: three_b_decompose
```

to:

```yaml
name: firstness_decompose
```

(Leave the rest of the YAML — `system_prompt`, `user_prompt_template`, etc. — untouched. The semantic content stays; only the identifier changes.)

- [ ] **Step 3: Update the engine constant**

In `backend/creative_os/three_b_engine.py`, change L50 from:

```python
DECOMPOSE_PROMPT = "three_b_decompose"
```

to:

```python
DECOMPOSE_PROMPT = "firstness_decompose"
```

The four sibling constants on L49/L51/L52 (`ADAPTIVE_DIVERGE_PROMPT`, `COMMIT_PROMPT`, `FOLLOW_UP_PROMPT`) and the docstring references to `three_b_state.json` are NOT touched — they describe the engine module / state file, not this specific prompt.

- [ ] **Step 4: Run the test file and confirm GREEN**

Run: `cd /Users/longsa/Codes/nebula && pytest backend/tests/test_three_b_yaml.py -v`

Expected: ALL tests pass, including:
- `test_firstness_decompose_yaml_exists` ✓
- `test_firstness_decompose_yaml_schema` (verifies `name == "firstness_decompose"`, the system_prompt still mentions `5 维度` / `ontology`, `causal_map` / `top_level_summary` still present) ✓
- `test_yaml_file_exists[firstness_decompose]` ✓
- `test_yaml_parses_with_expected_name[firstness_decompose]` ✓
- `test_plaza_discovers_all_four_three_b_prompts` — Plaza now finds `firstness_decompose.yaml` by stem ✓
- `test_load_prompt_effective_resolves_subdir_three_b_by_bare_stem[firstness_decompose]` — `load_prompt_effective("firstness_decompose")` returns a usable dict ✓
- `test_all_v2_yamls_in_creative_dir` — expected set still matches what's on disk ✓

If anything fails, stop and fix before proceeding — the rename is the only change in this commit, so any failure is in the rename.

- [ ] **Step 5: Commit**

Run:

```bash
cd /Users/longsa/Codes/nebula
git add backend/prompts/creative/firstness_decompose.yaml backend/tests/test_three_b_yaml.py backend/creative_os/three_b_engine.py
# Note: git mv in Step 1 already staged the rename; the two edits in Steps 2 + 3 are
# additional changes that need their own add.
git status --short
# Expected before `git add`:
#   R  backend/prompts/creative/three_b_decompose.yaml -> backend/prompts/creative/firstness_decompose.yaml
#    M backend/prompts/creative/firstness_decompose.yaml   (unstaged: the `name:` edit)
#    M backend/creative_os/three_b_engine.py               (unstaged: DECOMPOSE_PROMPT edit)
#    M backend/tests/test_three_b_yaml.py                  (unstaged: 9-site edit)
# `git mv` already staged the rename; the three `git add` commands above push the
# edits into the index so a single commit captures everything coherently.
git commit -m "refactor(prompt): rename three_b_decompose → firstness_decompose

The prompt performs first-principles (第一性原理) decomposition, so the
identifier now reflects what it is rather than the 3B brainstorm family
origin. Sibling prompts (three_b_adaptive_diverge / three_b_commit /
three_b_follow_up) keep their names — only this one is renamed.

Files touched:
- backend/prompts/creative/three_b_decompose.yaml → firstness_decompose.yaml
  (git mv preserves history; only the `name:` field and filename change)
- backend/creative_os/three_b_engine.py:50 (DECOMPOSE_PROMPT constant)
- backend/tests/test_three_b_yaml.py (9 references: docstring, set
  membership, dedicated test function names + Path strings + name
  assertion, and the v2-in-creative-dir expected set)

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

Verify: `git log -1 --stat` shows the rename (R) plus three modifications, all on the `nebula` branch.

---

### Task 3: Wider regression + grep verification

**Files:** none modified — this task only verifies.

- [ ] **Step 1: Run the routes test (engine module is exercised end-to-end)**

Run: `cd /Users/longsa/Codes/nebula && pytest backend/tests/test_api/test_three_b_routes.py -v`

Expected: all pass. The routes use `DECOMPOSE_PROMPT` from `three_b_engine.py`; if the constant value or the file lookup is wrong, these tests would surface it.

If anything fails, stop — the rename introduced a runtime regression. Most likely cause: the engine constant value diverges from the YAML `name:` field.

- [ ] **Step 2: Run the broader backend test suite for any 3B-touching modules**

Run: `cd /Users/longsa/Codes/nebula && pytest backend/tests/ -k "three_b or firstness" -v`

Expected: all pass — no leftover references to `three_b_decompose` cause failures.

- [ ] **Step 3: Verify no stale references to the old identifier remain in `backend/`**

Run: `cd /Users/longsa/Codes/nebula && grep -rn "three_b_decompose" backend/`

Expected: zero hits. If anything matches, that file is a missed reference — go fix it (it's likely a docstring, comment, or assertion that wasn't in the test file we edited in Task 1).

Also run, for completeness: `grep -rn "firstness_decompose" backend/`

Expected: at least these hits:
- `backend/prompts/creative/firstness_decompose.yaml` (the `name:` field)
- `backend/creative_os/three_b_engine.py` (the constant)
- `backend/tests/test_three_b_yaml.py` (multiple sites — at least the EXPECTED_NAMES entry, the dedicated test names, the Path strings, and the name assertion)

- [ ] **Step 4: Verify frontend is untouched**

Run: `cd /Users/longsa/Codes/nebula && grep -rn "three_b_decompose\|firstness_decompose" frontend/ 2>/dev/null`

Expected: zero hits either way (frontend doesn't reference either name; sanity check that the rename didn't accidentally introduce a coupling).

- [ ] **Step 5: Verify historical docs are untouched (per user decision)**

Run: `cd /Users/longsa/Codes/nebula && git status --short docs/superpowers/`

Expected: empty output (no modifications to historical specs or plans). The only commits in this work are the design commit (`14e93d2`) and the implementation commit from Task 2 Step 5.

- [ ] **Step 6: Final summary**

Report back:
- Implementation commit hash
- Files changed in the implementation commit
- Test results (counts: passed / failed / skipped for `test_three_b_yaml.py` and `test_three_b_routes.py`)
- Grep verification: zero hits for `three_b_decompose` under `backend/`; expected hits for `firstness_decompose`

---

## Risks & notes

- **`git mv` vs `mv`:** Use `git mv`. Plain `mv` would make git see a delete + add and lose file history. Task 2 Step 1 specifies `git mv` explicitly.
- **Order within Task 2 matters:** `git mv` first (stages the rename), then edit the `name:` field inside the renamed file (because the file is now at the new path), then edit the engine constant. Reversing this order is recoverable but creates a brief window where the file is on disk at the new path but git doesn't know about the rename yet.
- **Prompt Plaza overrides:** Verified in brainstorming — `config/global_prompt_overrides.json` has no entry for either name, and no per-project overrides exist. If a user has created overrides via the Plaza UI since the brainstorming check, they'd now dangle — but since the rename is requested explicitly, this is the intended behavior.
- **No backwards-compat shim:** YAGNI. There's no external consumer of the prompt identifier; `load_prompt_effective("three_b_decompose")` will now raise, and that's correct.
- **Sibling prompts unchanged:** Resist the urge to also rename `three_b_adaptive_diverge` etc. — out of scope per user decision.
- **Historical docs unchanged:** `docs/superpowers/specs/2026-09-06-…` and `docs/superpowers/plans/2026-09-06-…` (and the 2026-09-10 versions) keep all references to `three_b_decompose`. They are frozen historical records.