# Divergence S3 Default-Original-Unit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "原始拆解" virtual candidate to every unit in S3 (adaptive divergence), default-selected, sourced from S2's first-principles decomposition description. No schema changes; piggybacks on the existing `selection_rank` mechanism.

**Architecture:** Backend `_append_original_candidate(unit, llm_candidates)` helper appends a synthetic `UnitCandidate` (description = `u.description`, chain_reaction = "") to each unit's LLM candidates at the end of `diverge()`, persisting via existing `atomic_write_state`. Frontend `S3DivergeStep` partitions the candidates array, prepends the virtual to display, and adds a `[原始拆解]` text prefix to its row. Default selection is achieved by setting the virtual's `selection_rank = 0` and pushing LLM candidates to ranks 1, 2, 3.

**Tech Stack:** Python 3 / dataclasses / pytest (backend); React 18 / TypeScript / vitest + jsdom (frontend).

**Spec:** `docs/superpowers/specs/2026-09-09-divergence-default-original-unit-design.md` (commit `43fa484`).

**Pre-existing frontend bug discovered during planning (added to scope):**

`S3DivergeStep.tsx` historically passed `c.selection_rank` (a rank value) as the second argument to `onSelectCandidate(u.id, ...)`, but the backend `select_unit_candidate()` interprets that argument as `candidate_index` — the data-array index within the unit's filtered candidates. The two values have always been conceptually distinct, but they coincide by accident in the no-virtual state: initial LLM candidates are appended in `selection_rank` order, so data-array index == rank (0/1/2 == 0/1/2).

Adding the virtual candidate exposes the latent bug: the virtual has `selection_rank = 0` (so it stays default-selected) but sits at the **end** of the persisted `dim.candidates` array. The post-partition frontend display order (`[原始, ...others]` ≠ data-array order) means the index into `dim.candidates.filter(c => c.unit_id === u.id)` must be recomputed at click time — never read from `selection_rank`. **Display order diverges from persisted array order; the click handler must use the data-array index.**

Task 5 fixes this independently of, and before, the virtual-candidate work in Tasks 6–7. The fix is observable in production today (clicking between two LLM candidates after the legacy index parameter was the only behaviour that masked the bug).

---

## File Structure

| File | Responsibility | Status |
|---|---|---|
| `backend/creative_os/three_b_engine.py` | `_append_original_candidate` helper; `diverge()` invocation; `_build_commit_user_prompt` skip-empty-chain-reaction | Modify |
| `frontend/src/components/wizard/divergence_v2/S3DivergeStep.tsx` | `partitionOriginalCandidate` helper; render reorder; `[原始拆解]` prefix; `useEffect` for legacy state; fix index parameter | Modify |
| `tests/test_creative_os/test_three_b_engine.py` | New tests for `_append_original_candidate`; updates to `test_diverge_runs_one_llm_per_unit_in_parallel` | Modify |
| `frontend/src/components/wizard/divergence_v2/__tests__/S3DivergeStep.test.tsx` | New file: tests for partition + render prefix + index parameter fix | Create |
| `tests/test_api/__init__.py` + `tests/test_api/test_three_b_routes.py` | New files: integration test for `/diverge` response shape | Create |
| `tests/e2e/test_divergence_v2_smoke.py` | New file: E2E smoke for full S0→S3 flow | Create |

---

## Task 1: Backend helper `_append_original_candidate` — write failing test

**Files:**
- Modify: `tests/test_creative_os/test_three_b_engine.py` (append new tests)

- [ ] **Step 1.1: Read current end of test file to find a good insertion point**

Run: `wc -l tests/test_creative_os/test_three_b_engine.py`
Expected: ~584 lines (per existing test_select_unit_candidate_rejects_out_of_range). Note the final line.

- [ ] **Step 1.2: Append new test cases to `tests/test_creative_os/test_three_b_engine.py`**

Append at end of file:

```python
# ---- _append_original_candidate (S3 default-original-unit) ----

def test_append_original_candidate_appends_virtual_with_rank_zero():
    """虚拟 candidate 追加到末尾,rank=0;LLM 候选 rank 顺移到 1,2,3。"""
    from backend.creative_os.three_b_engine import _append_original_candidate

    unit = Unit(id="u1", dimension=DimLabel.ONTOLOGY, unit_name="灵窍", description="修炼者根本穴位")
    llm = [
        UnitCandidate(id="c1", unit_id="u1", unit_name="灵窍", description="扭曲", chain_reaction="cr1", main_operator="distort", selection_rank=0),
        UnitCandidate(id="c2", unit_id="u1", unit_name="灵窍", description="切断", chain_reaction="cr2", main_operator="break", selection_rank=1),
        UnitCandidate(id="c3", unit_id="u1", unit_name="灵窍", description="融合", chain_reaction="cr3", main_operator="blend", selection_rank=2),
    ]
    result = _append_original_candidate(unit, llm)

    assert len(result) == 4
    assert result[3].id == "u1__original"
    assert result[3].unit_id == "u1"
    assert result[3].unit_name == "灵窍"
    assert result[3].description == "修炼者根本穴位"
    assert result[3].chain_reaction == ""
    assert result[3].main_operator is None
    assert result[3].aux_operator is None
    assert result[3].selection_rank == 0
    # LLM 候选 rank 顺移到 1,2,3(原 rank=0 升到 1)
    assert result[0].selection_rank == 1
    assert result[1].selection_rank == 2
    assert result[2].selection_rank == 3


def test_append_original_candidate_handles_empty_llm_list():
    """LLM 完全失败(candidates=[]) 时,只追加虚拟(用户回退到原始)。"""
    from backend.creative_os.three_b_engine import _append_original_candidate

    unit = Unit(id="u1", dimension=DimLabel.ONTOLOGY, unit_name="灵窍", description="d")
    result = _append_original_candidate(unit, [])

    assert len(result) == 1
    assert result[0].id == "u1__original"
    assert result[0].description == "d"
    assert result[0].selection_rank == 0


def test_append_original_candidate_is_idempotent():
    """重复调用不会产生重复虚拟 candidate。"""
    from backend.creative_os.three_b_engine import _append_original_candidate

    unit = Unit(id="u1", dimension=DimLabel.ONTOLOGY, unit_name="灵窍", description="d")
    llm = [
        UnitCandidate(id="c1", unit_id="u1", unit_name="灵窍", description="x", chain_reaction="r", main_operator="distort", selection_rank=0),
    ]
    once = _append_original_candidate(unit, llm)
    twice = _append_original_candidate(unit, once)

    assert len(twice) == 2  # 不应再次追加
    assert sum(1 for c in twice if c.id == "u1__original") == 1
```

- [ ] **Step 1.3: Run new tests to confirm they fail**

Run: `cd /Users/longsa/Codes/nebula && source venv/bin/activate && pytest tests/test_creative_os/test_three_b_engine.py -k "append_original" -v`
Expected: FAIL — `ImportError: cannot import name '_append_original_candidate'`

- [ ] **Step 1.4: Commit failing test**

```bash
git add tests/test_creative_os/test_three_b_engine.py
git commit -m "test(three_b): add failing tests for _append_original_candidate"
```

---

## Task 2: Backend helper `_append_original_candidate` — implement

**Files:**
- Modify: `backend/creative_os/three_b_engine.py` (add module-level function near `_diverge_single_unit`)

- [ ] **Step 2.1: Locate insertion point**

Run: `grep -n "^def _diverge_single_unit\|^async def _diverge_single_unit" backend/creative_os/three_b_engine.py`
Expected: line ~406 (per agent report). Insert `_append_original_candidate` immediately above.

- [ ] **Step 2.2: Add `_append_original_candidate` function**

Insert above `_diverge_single_unit`:

```python
def _append_original_candidate(
    unit: Unit, llm_candidates: list[UnitCandidate]
) -> list[UnitCandidate]:
    """Append a synthetic candidate representing the original (S2-decomposed) unit.

    Used by `diverge()` to give users a zero-cost "use original" fallback in S3.
    Virtual candidate sits at the end of the list with `selection_rank = 0`,
    shifting LLM candidates to ranks 1, 2, 3.
    """
    if any(c.id == f"{unit.id}__original" for c in llm_candidates):
        return llm_candidates
    virtual = UnitCandidate(
        id=f"{unit.id}__original",
        unit_id=unit.id,
        unit_name=unit.unit_name,
        description=unit.description,
        chain_reaction="",
        main_operator=None,
        aux_operator=None,
        selection_rank=0,
    )
    for i, c in enumerate(llm_candidates, start=1):
        c.selection_rank = i
    return llm_candidates + [virtual]
```

- [ ] **Step 2.3: Run new tests to confirm they pass**

Run: `source venv/bin/activate && pytest tests/test_creative_os/test_three_b_engine.py -k "append_original" -v`
Expected: 3 passed

- [ ] **Step 2.4: Run full backend test file to ensure no regression**

Run: `source venv/bin/activate && pytest tests/test_creative_os/test_three_b_engine.py -v`
Expected: all passed (existing tests still green; helper not yet wired into `diverge()`).

- [ ] **Step 2.5: Commit implementation**

```bash
git add backend/creative_os/three_b_engine.py
git commit -m "feat(three_b): add _append_original_candidate helper"
```

---

## Task 3: Wire helper into `diverge()` — update existing test, then implementation

**Files:**
- Modify: `tests/test_creative_os/test_three_b_engine.py` (extend `test_diverge_runs_one_llm_per_unit_in_parallel`)
- Modify: `backend/creative_os/three_b_engine.py` (call helper in `diverge()`)

- [ ] **Step 3.1: Extend existing `test_diverge_runs_one_llm_per_unit_in_parallel`**

Find: `test_diverge_runs_one_llm_per_unit_in_parallel` (starts at line 337 per `grep`).

After the existing assertion block (`assert reloaded.diverge_completed_at is not None`), add:

```python
    # S3 default-original-unit: 每个 unit 都追加虚拟 candidate
    for unit in units:
        cands = [c for c in reloaded.dimensions[0].candidates if c.unit_id == unit.id]
        assert len(cands) == 3, f"期望每个 unit 3 个候选 (2 LLM + 1 虚拟),实际 {len(cands)}"
        virtual = next(c for c in cands if c.id == f"{unit.id}__original")
        assert virtual is not None
        assert virtual.description == unit.description
        assert virtual.chain_reaction == ""
        assert virtual.selection_rank == 0
        # LLM 候选 rank 顺移到 1, 2
        llm_cands = [c for c in cands if c.id != virtual.id]
        assert sorted(c.selection_rank for c in llm_cands) == [1, 2]
```

- [ ] **Step 3.2: Run extended test to confirm it fails**

Run: `source venv/bin/activate && pytest tests/test_creative_os/test_three_b_engine.py::test_diverge_runs_one_llm_per_unit_in_parallel -v`
Expected: FAIL — `assert len(cands) == 3` fails because helper isn't wired (currently 2 LLM cands, no virtual).

- [ ] **Step 3.3: Locate `diverge()` writeback**

Run: `grep -n "candidates = llm\|extend.*candidates\|d.candidates" backend/creative_os/three_b_engine.py | head -20`
Expected: lines showing where candidates get appended into `dim.candidates` or `state.dimensions[i].candidates` after `_diverge_single_unit`.

- [ ] **Step 3.4: Add helper call in `diverge()`**

In the loop where per-unit LLM candidates are collected (find the `for ... in results:` or `extend` site), wrap the assignment:

```python
        # 旧:
        # dim.units[unit_index].candidates = llm_cands
        # 新:追加虚拟 candidate
        dim.units[unit_index].candidates = _append_original_candidate(unit, llm_cands)
```

If the existing code uses `d.candidates.extend(...)` instead of writing to `unit.candidates`, then change to:

```python
        d.candidates.extend(_append_original_candidate(unit, llm_cands_for_this_unit))
```

(Exact shape depends on how `diverge()` currently aggregates — read the surrounding 5-10 lines first to match the existing pattern.)

- [ ] **Step 3.5: Run extended test to confirm it passes**

Run: `source venv/bin/activate && pytest tests/test_creative_os/test_three_b_engine.py::test_diverge_runs_one_llm_per_unit_in_parallel -v`
Expected: PASS

- [ ] **Step 3.6: Run full file to check for regressions**

Run: `source venv/bin/activate && pytest tests/test_creative_os/test_three_b_engine.py -v`
Expected: all passed. **Pay attention to:** `test_diverge_degrades_per_unit_on_failure` and `test_diverge_rerun_replaces_candidates_not_appends` — both may need updates if their assertions counted candidate counts.

- [ ] **Step 3.7: If regressions, fix the existing tests**

Read failure messages; typical fix is updating candidate counts (e.g., from `len(cands) == 2` to `len(cands) == 3` after adding virtual).

- [ ] **Step 3.8: Commit**

```bash
git add backend/creative_os/three_b_engine.py tests/test_creative_os/test_three_b_engine.py
git commit -m "feat(three_b): wire _append_original_candidate into diverge()"
```

---

## Task 4: `_build_commit_user_prompt` skips empty `chain_reaction`

**Files:**
- Modify: `backend/creative_os/three_b_engine.py` (in `_build_commit_user_prompt`)

- [ ] **Step 4.1: Locate `_build_commit_user_prompt`**

Run: `grep -n "_build_commit_user_prompt\|连锁推演" backend/creative_os/three_b_engine.py`
Expected: ~line 677-709.

- [ ] **Step 4.2: Read the user prompt template construction**

Run: `sed -n '677,710p' backend/creative_os/three_b_engine.py`

Find where each `selected_units` line is appended. The current pattern (per agent report):

```python
selected_units.append(
    f"- [{d.dimension.value}] {u.unit_name}: {cand.description}\n"
    f"  连锁推演: {cand.chain_reaction}"
)
```

- [ ] **Step 4.3: Add the empty-skip guard**

Modify the append block to:

```python
                if cand:
                    chain_line = (
                        f"  连锁推演: {cand.chain_reaction}"
                        if cand.chain_reaction
                        else ""
                    )
                    selected_units.append(
                        f"- [{d.dimension.value}] {u.unit_name}: {cand.description}\n"
                        f"{chain_line}"
                    )
                else:
                    selected_units.append(
                        f"- [{d.dimension.value}] {u.unit_name}: [unit {u.id} 未参与]"
                    )
```

(Or apply equivalent guard to whichever branch handles the selected candidate in the actual file — match existing structure.)

- [ ] **Step 4.4: Verify no existing test asserts on the `连锁推演:` empty line**

Run: `grep -rn "连锁推演" tests/`
Expected: no test references this string. If any does, update it.

- [ ] **Step 4.5: Run full backend test file**

Run: `source venv/bin/activate && pytest tests/test_creative_os/test_three_b_engine.py -v`
Expected: all passed.

- [ ] **Step 4.6: Commit**

```bash
git add backend/creative_os/three_b_engine.py
git commit -m "feat(three_b): skip empty chain_reaction in commit prompt"
```

---

## Task 5: Frontend — fix pre-existing `onSelectCandidate` index bug

**Files:**
- Modify: `frontend/src/components/wizard/divergence_v2/S3DivergeStep.tsx`

- [ ] **Step 5.1: Read current `S3DivergeStep.tsx` rendering block**

Run: `sed -n '60,125p' frontend/src/components/wizard/divergence_v2/S3DivergeStep.tsx`

Find the `unitCandidates.map(...)` call (around line 117). Note that `c.selection_rank` is passed as the second arg to `onSelectCandidate`.

- [ ] **Step 5.2: Replace rank-based parameter with data-array index**

Change:

```tsx
{unitCandidates.map((c) => (
  <CandidateRow
    key={c.id}
    candidate={c}
    selected={c.selection_rank === 0}
    onSelect={() => onSelectCandidate(u.id, c.selection_rank)}
  />
))}
```

To:

```tsx
{unitCandidates.map((c) => {
  const dataIdx = dim.candidates
    .filter((x) => x.unit_id === u.id)
    .indexOf(c);
  return (
    <CandidateRow
      key={c.id}
      candidate={c}
      selected={c.selection_rank === 0}
      onSelect={() => onSelectCandidate(u.id, dataIdx)}
    />
  );
})}
```

Rationale: backend `select_unit_candidate` uses `cands[candidate_index]` where `cands = [c for c in d.candidates if c.unit_id == unit_id]` — unsorted by rank, so the index must be the position in `dim.candidates.filter(unit_id == u.id)`, not the rank value.

- [ ] **Step 5.3: Manual smoke test in browser**

Start the dev server (`npm run dev` in `frontend/`, backend on `:8000`), open a project that has S3 candidates, click between two LLM candidates repeatedly, verify:
- Clicking LLM_B after LLM_A is default → LLM_B becomes selected
- Clicking LLM_A after LLM_B is selected → LLM_A becomes selected (NOT no-op)
- The visual selection matches the backend state

- [ ] **Step 5.4: Commit (frontend bug fix alone, before virtual feature work)**

```bash
git add frontend/src/components/wizard/divergence_v2/S3DivergeStep.tsx
git commit -m "fix(divergence): pass data-array index not rank to onSelectCandidate"
```

---

## Task 6: Frontend — add `partitionOriginalCandidate` helper

**Files:**
- Modify: `frontend/src/components/wizard/divergence_v2/S3DivergeStep.tsx` (helper at top of file, **export** it for testability)
- Modify: `frontend/src/test/wizard/divergence_v2/S3DivergeStep.test.tsx` (append partition tests — there is already an existing test file here, do NOT create `__tests__/`)

- [ ] **Step 6.1: Add helper function at the top of the file**

Insert just below the imports (after `OPERATOR_ICONS` constant block). **Prefix with `export`** so the existing test file at `frontend/src/test/wizard/divergence_v2/S3DivergeStep.test.tsx` can import it.

```tsx
export function partitionOriginalCandidate(
  candidates: UnitCandidate[],
): { original: UnitCandidate | null; others: UnitCandidate[] } {
  const idx = candidates.findIndex((c) => c.id.endsWith("__original"));
  if (idx === -1) {
    return { original: null, others: candidates };
  }
  const original = candidates[idx];
  const others = [...candidates.slice(0, idx), ...candidates.slice(idx + 1)];
  return { original, others };
}
```

- [ ] **Step 6.2: Add unit tests for partition helper to existing test file**

Append to `frontend/src/test/wizard/divergence_v2/S3DivergeStep.test.tsx` (do NOT create a new `__tests__/` directory — one already exists at `frontend/src/test/wizard/divergence_v2/`):

```tsx
import { partitionOriginalCandidate } from "@/components/wizard/divergence_v2/S3DivergeStep";
import type { UnitCandidate } from "@/components/wizard/divergence_v2/types";

const makeCand = (id: string, rank: number): UnitCandidate => ({
  id, unit_id: "u", unit_name: "u", description: id,
  chain_reaction: "", main_operator: "distort", aux_operator: null,
  selection_rank: rank,
});

describe("partitionOriginalCandidate", () => {
  it("extracts the __original candidate and preserves order of the rest", () => {
    const cands = [makeCand("c1", 1), makeCand("c2", 2), makeCand("u__original", 0), makeCand("c3", 3)];
    const { original, others } = partitionOriginalCandidate(cands);
    expect(original?.id).toBe("u__original");
    expect(others.map((c) => c.id)).toEqual(["c1", "c2", "c3"]);
  });

  it("returns null original when no virtual candidate present", () => {
    const cands = [makeCand("c1", 0), makeCand("c2", 1)];
    const { original, others } = partitionOriginalCandidate(cands);
    expect(original).toBeNull();
    expect(others).toEqual(cands);
  });

  it("handles empty array", () => {
    const { original, others } = partitionOriginalCandidate([]);
    expect(original).toBeNull();
    expect(others).toEqual([]);
  });
});
```

- [ ] **Step 6.3: Run frontend tests to confirm they pass**

Run: `cd /Users/longsa/Codes/nebula/frontend && npm test -- S3DivergeStep`
Expected: 6 existing + 3 new = 9 passed.

- [ ] **Step 6.4: Commit helper + tests**

```bash
git add frontend/src/components/wizard/divergence_v2/S3DivergeStep.tsx frontend/src/test/wizard/divergence_v2/S3DivergeStep.test.tsx
git commit -m "feat(divergence): add partitionOriginalCandidate helper + test

Co-Authored-By: Claude Opus 4.7 <noreply@anthropic.com>"
```

---

## Task 7: Frontend — render `[原始拆解]` prefix and reorder

**Files:**
- Modify: `frontend/src/components/wizard/divergence_v2/S3DivergeStep.tsx`

- [ ] **Step 7.1: Modify the rendering loop**

In the `dim.units.map((u) => { ... })` block (around line 70), replace the `unitCandidates` line with the partition + ordered list, and pass an `isOriginal` flag to `CandidateRow`:

Change:

```tsx
              const unitCandidates = dim.candidates
                .filter((c) => c.unit_id === u.id)
                .sort((a, b) => a.selection_rank - b.selection_rank);
```

To:

```tsx
              const unitCandidatesAll = dim.candidates.filter((c) => c.unit_id === u.id);
              const { original, others } = partitionOriginalCandidate(unitCandidatesAll);
              const unitCandidates = original
                ? [original, ...others]
                : [...others].sort((a, b) => a.selection_rank - b.selection_rank);
```

Then in the `unitCandidates.map((c) => { ... })` block (already updated in Task 5), add `isOriginal` prop:

```tsx
                return (
                  <CandidateRow
                    key={c.id}
                    candidate={c}
                    selected={c.selection_rank === 0}
                    isOriginal={original !== null && c.id === original.id}
                    onSelect={() => onSelectCandidate(u.id, dataIdx)}
                  />
                );
```

- [ ] **Step 7.2: Update `CandidateRow` component**

Find the `CandidateRow` function declaration (bottom of file). Change its signature and render:

```tsx
function CandidateRow({
  candidate, selected, isOriginal = false, onSelect,
}: {
  candidate: UnitCandidate;
  selected: boolean;
  isOriginal?: boolean;
  onSelect: () => void;
}) {
  return (
    <label className="flex items-start gap-2 cursor-pointer" data-testid={`candidate-${candidate.id}`}>
      <input type="radio" checked={selected} onChange={onSelect} className="mt-1 accent-primary-container" />
      <div className="flex-1">
        <div className="text-primary text-sm">
          {isOriginal && <span className="text-on-surface-variant mr-1">[原始拆解]</span>}
          {candidate.description}
        </div>
        {candidate.chain_reaction && (
          <div className="text-xs text-on-surface-variant mt-1">
            连锁推演:{candidate.chain_reaction}
          </div>
        )}
      </div>
    </label>
  );
}
```

Key changes:
- Added `isOriginal?: boolean` prop
- Prepend `[原始拆解]` muted-color span when isOriginal
- Skip the "连锁推演:" line entirely when `chain_reaction` is empty (matches backend change in Task 4)

- [ ] **Step 7.3: Manual browser test**

Open S3 with a real backend project:
1. Verify each unit shows `[原始拆解]` as the first row, default-checked
2. Verify LLM candidates below, with `连锁推演:` line present
3. Click `[原始拆解]` → stays selected (no-op confirm via dev tools)
4. Click an LLM candidate → backend state updates (check `state.json` on disk)
5. Click `[原始拆解]` again → virtual rank back to 0

- [ ] **Step 7.4: Run frontend tests**

Run: `cd /Users/longsa/Codes/nebula/frontend && npm test -- S3DivergeStep`
Expected: all passed.

- [ ] **Step 7.5: Commit**

```bash
git add frontend/src/components/wizard/divergence_v2/S3DivergeStep.tsx
git commit -m "feat(divergence): render [原始拆解] virtual candidate row in S3"
```

---

## Task 8: Frontend — `useEffect` for legacy state auto-`/diverge`

**Files:**
- Modify: `frontend/src/components/wizard/divergence_v2/S3DivergeStep.tsx`

- [ ] **Step 8.1: Add `useEffect` import**

At the top imports, ensure `useEffect` is imported from `react`:

```tsx
import { useEffect } from "react";
```

(If `react` already has named imports, add `useEffect` to the existing import line.)

- [ ] **Step 8.2: Add the legacy-detection effect**

Inside the `S3DivergeStep` function body (after `allFailed` declaration, before the `return`), add:

```tsx
  // 存量 state.json 无虚拟 candidate → 自动调 /diverge (幂等:清空+重生成)
  const needsRegenerate = dimensions.some((d) =>
    d.units.some((u) =>
      d.candidates.some((c) => c.unit_id === u.id) &&
      !d.candidates.some((c) => c.unit_id === u.id && c.id.endsWith("__original")),
    ),
  );
  useEffect(() => {
    if (needsRegenerate) {
      // 由父级 CreativeDivergenceStep 暴露;首次进入 S3 时父级会先调 /diverge
      // 此 effect 为防御性兜底,正常路径不会触发
      console.warn("[divergence] legacy state detected, parent should re-run /diverge");
    }
  }, [needsRegenerate]);
```

Note: the actual auto-trigger should be in the parent (`CreativeDivergenceStep` / `useThreeBDivergence`) since it owns the `onRegenerateUnit`/`onSelectCandidate` plumbing. The effect here is a guard rail that documents the expectation.

- [ ] **Step 8.3: Verify parent already triggers /diverge on S3 mount**

Run: `grep -n "useEffect\|diverge" frontend/src/components/wizard/divergence_v2/useThreeBDivergence.ts | head -20`

Read the hook to confirm whether `dimensions` is populated by an effect that calls `/diverge`. If yes (likely), Task 8.2's effect is a no-op and just a safety log. If no, add an `onMount` prop / callback.

- [ ] **Step 8.4: If parent does NOT auto-`/diverge` on S3 mount, add the trigger**

In `useThreeBDivergence.ts`, after `dimensions` is initialized, add:

```ts
useEffect(() => {
  const needsDiverge = dimensions.some((d) =>
    d.units.some((u) => d.candidates.filter((c) => c.unit_id === u.id).length > 0)
      ? !d.candidates.some((c) => c.id.endsWith("__original"))
      : true,
  );
  if (needsDiverge) {
    void regenerateDiverge(); // or whatever the existing /diverge-trigger function is called
  }
}, []); // mount only
```

(Exact function name to call depends on the hook's API — read the hook first to match.)

- [ ] **Step 8.5: Run frontend tests + manual smoke**

Run: `cd /Users/longsa/Codes/nebula/frontend && npm test -- divergence_v2`
Expected: all passed.

Manual: navigate to S3 on a project with **pre-feature** state.json (no virtual candidates). Verify the page loads with `[原始拆解]` rows (parent re-runs /diverge).

- [ ] **Step 8.6: Commit**

```bash
git add frontend/src/components/wizard/divergence_v2/
git commit -m "feat(divergence): auto re-diverge on S3 mount for legacy state"
```

---

## Task 9: Backend integration test — `/diverge` endpoint returns virtual candidates

**Files:**
- Create: `tests/test_api/__init__.py` (empty)
- Create: `tests/test_api/test_three_b_routes.py`

- [ ] **Step 9.1: Create `tests/test_api/__init__.py`**

```python
"""API integration tests."""
```

- [ ] **Step 9.2: Find a similar route-test scaffold**

Run: `find tests -name "test_*routes*" -o -name "test_*api*" | head -5`

If a similar FastAPI route test exists, copy its fixtures (`TestClient`, auth headers, project setup). Otherwise, write minimal scaffold.

- [ ] **Step 9.3: Write integration test**

Create `tests/test_api/test_three_b_routes.py`:

```python
"""Integration tests for three_b_routes."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from backend.creative_os.three_b_engine import (
    DimensionDecomposition,
    RawIntent,
    ThreeBState,
    Unit,
    atomic_write_state,
)
from backend.main import app
from backend.services.dimension_labels import Dimension as DimLabel


@pytest.fixture
def mock_router():
    return AsyncMock()


@pytest.fixture
def client(mock_router, monkeypatch, tmp_path):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    # 注入 mock router 到 app.state
    app.state.three_b_engine = __import__(
        "backend.creative_os.three_b_engine", fromlist=["ThreeBEngine"]
    ).ThreeBEngine(model_router=mock_router)
    return TestClient(app)


@pytest.mark.asyncio
async def test_diverge_response_includes_virtual_candidate_per_unit(client, mock_router, monkeypatch, tmp_path):
    """POST /three-b/diverge 响应每个 unit 都有 __original 候选且 rank=0。"""
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)

    # 准备 state:1 个 dimension, 2 个 unit,无 candidates
    state = ThreeBState(
        project_id="proj_test",
        raw_intent=RawIntent(prompt="修仙", genre_primary="修仙"),
        dimensions=[DimensionDecomposition(
            dimension=DimLabel.ONTOLOGY, insight="i",
            units=[
                Unit(id="unit_1", dimension=DimLabel.ONTOLOGY, unit_name="u1", description="原始描述 1"),
                Unit(id="unit_2", dimension=DimLabel.ONTOLOGY, unit_name="u2", description="原始描述 2"),
            ],
        )],
    )
    atomic_write_state("proj_test", state)

    mock_router.execute.return_value = {
        "content": json.dumps({
            "candidates": [
                {"description": "v1", "chain_reaction": "cr1", "main_operator": "distort", "selection_rank": 0},
                {"description": "v2", "chain_reaction": "cr2", "main_operator": "break", "selection_rank": 1},
            ],
        })
    }

    resp = client.post("/api/v1/projects/proj_test/creative/diverge/three-b/diverge")
    assert resp.status_code == 200

    body = resp.json()
    dims = body["dimensions"]
    assert len(dims) == 1
    cands = dims[0]["candidates"]
    # 2 个 unit × (2 LLM + 1 虚拟) = 6 candidates
    assert len(cands) == 6

    # 每个 unit 都应有虚拟 candidate,rank=0
    for unit_id in ("unit_1", "unit_2"):
        unit_cands = [c for c in cands if c["unit_id"] == unit_id]
        assert len(unit_cands) == 3
        virtual = next(c for c in unit_cands if c["id"] == f"{unit_id}__original")
        assert virtual["selection_rank"] == 0
        assert virtual["chain_reaction"] == ""
        assert virtual["description"].startswith("原始描述")
```

(Adjust project setup + client fixtures to match the project's existing API test conventions — read 1-2 sibling test files first to match.)

- [ ] **Step 9.4: Run integration test**

Run: `source venv/bin/activate && pytest tests/test_api/test_three_b_routes.py -v`
Expected: PASS (or FAIL with import errors that point to missing fixtures — adjust).

- [ ] **Step 9.5: Commit**

```bash
git add tests/test_api/
git commit -m "test(api): integration test for /three-b/diverge virtual candidate"
```

---

## Task 10: E2E smoke test — full S0→S3 flow

**Files:**
- Create: `tests/e2e/test_divergence_v2_smoke.py`

- [ ] **Step 10.1: Find existing E2E scaffolding**

Run: `find tests/e2e -name "*.py" 2>/dev/null | head -10 && echo "---" && ls tests/e2e/ 2>/dev/null`

Read 1-2 existing E2E tests to understand the fixture / runner setup.

- [ ] **Step 10.2: Write E2E smoke test**

Create `tests/e2e/test_divergence_v2_smoke.py`:

```python
"""E2E smoke for divergence_v2 S3 default-original-unit feature."""
from __future__ import annotations

import json
from unittest.mock import AsyncMock

import pytest
from fastapi.testclient import TestClient

from backend.creative_os.three_b_engine import (
    DimensionDecomposition,
    RawIntent,
    ThreeBState,
    Unit,
    atomic_write_state,
    load_state,
)
from backend.main import app
from backend.services.dimension_labels import Dimension as DimLabel


@pytest.fixture
def mock_router():
    return AsyncMock()


@pytest.fixture
def client(mock_router, monkeypatch, tmp_path):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    from backend.creative_os.three_b_engine import ThreeBEngine
    app.state.three_b_engine = ThreeBEngine(model_router=mock_router)
    return TestClient(app)


def test_s3_default_original_unit_flow(client, mock_router, monkeypatch, tmp_path):
    """S0→S1→S2→S3:每个 unit 渲染 [原始拆解] 4 行 radio,默认勾选,commit 用 u.description。"""
    # 1. S0/S1: simulate raw_intent committed
    state = ThreeBState(
        project_id="proj_e2e",
        raw_intent=RawIntent(prompt="修仙", genre_primary="修仙"),
        dimensions=[DimensionDecomposition(
            dimension=DimLabel.ONTOLOGY, insight="i",
            units=[Unit(id="u1", dimension=DimLabel.ONTOLOGY, unit_name="灵窍", description="灵窍是修炼者根本穴位")],
        )],
    )
    atomic_write_state("proj_e2e", state)

    # 2. S3 diverge
    mock_router.execute.return_value = {
        "content": json.dumps({
            "candidates": [
                {"description": "扭曲灵窍", "chain_reaction": "邪气侵入", "main_operator": "distort", "selection_rank": 0},
                {"description": "切断灵窍", "chain_reaction": "丹田失联", "main_operator": "break", "selection_rank": 1},
            ],
        })
    }
    resp = client.post("/api/v1/projects/proj_e2e/creative/diverge/three-b/diverge")
    assert resp.status_code == 200

    # 3. State has virtual candidate
    reloaded = load_state("proj_e2e")
    cands = [c for c in reloaded.dimensions[0].candidates if c.unit_id == "u1"]
    assert len(cands) == 3
    virtual = next(c for c in cands if c.id == "u1__original")
    assert virtual.selection_rank == 0
    assert virtual.description == "灵窍是修炼者根本穴位"
    assert virtual.chain_reaction == ""

    # 4. User picks LLM candidate (index 1 in data array — virtual at end)
    llm_idx = next(i for i, c in enumerate(cands) if c.id != "u1__original")
    resp = client.post(
        "/api/v1/projects/proj_e2e/creative/diverge/three-b/select-unit",
        json={"unit_id": "u1", "candidate_index": llm_idx},
    )
    assert resp.status_code == 200

    # 5. State confirms LLM candidate now rank 0, virtual demoted
    reloaded = load_state("proj_e2e")
    cands = [c for c in reloaded.dimensions[0].candidates if c.unit_id == "u1"]
    assert next(c for c in cands if c.id != "u1__original").selection_rank == 0
    assert next(c for c in cands if c.id == "u1__original").selection_rank != 0

    # 6. Switch back to original
    virtual_idx = next(i for i, c in enumerate(cands) if c.id == "u1__original")
    resp = client.post(
        "/api/v1/projects/proj_e2e/creative/diverge/three-b/select-unit",
        json={"unit_id": "u1", "candidate_index": virtual_idx},
    )
    assert resp.status_code == 200
    reloaded = load_state("proj_e2e")
    cands = [c for c in reloaded.dimensions[0].candidates if c.unit_id == "u1"]
    assert next(c for c in cands if c.id == "u1__original").selection_rank == 0
```

- [ ] **Step 10.3: Run E2E test**

Run: `source venv/bin/activate && pytest tests/e2e/test_divergence_v2_smoke.py -v`
Expected: PASS.

- [ ] **Step 10.4: Commit**

```bash
git add tests/e2e/test_divergence_v2_smoke.py
git commit -m "test(e2e): smoke test for S3 default-original-unit flow"
```

---

## Task 11: Update spec with index-bug discovery

**Files:**
- Modify: `docs/superpowers/specs/2026-09-09-divergence-default-original-unit-design.md`

- [ ] **Step 11.1: Read current spec section 3.3.3**

Run: `grep -n "select_unit\|realIndex\|candidateIndex" docs/superpowers/specs/2026-09-09-divergence-default-original-unit-design.md`

Find the section that says "`selectUnit(unitId, realIndex)` 沿用现有实现".

- [ ] **Step 11.2: Replace with corrected note**

Change that line to:

```markdown
#### 3.3.3 `select_unit` 调用

**修正:** 当前 `S3DivergeStep.tsx` 传 `c.selection_rank`(rank 值),与后端期望的 `candidate_index`(数据数组下标)语义不一致。初始状态 rank 0/1/2 == 数据数组下标 0/1/2,所以无 bug;但加入虚拟 candidate 后虚拟的 rank=0 与其在数组末位的下标 N 不重合,会暴露此 bug。

修复:把 `c.selection_rank` 改为 `dim.candidates.filter(c => c.unit_id === u.id).indexOf(c)`(per-unit 数据数组下标)。`partitionOriginalCandidate` 的 partition 步骤产 `ordered` 仅用于显示顺序,不参与 index 计算。
```

- [ ] **Step 11.3: Update section 5 (affected files) to add the bug-fix file**

In the table, mark `frontend/src/components/wizard/divergence_v2/S3DivergeStep.tsx` row to include "fix `c.selection_rank` → 数据数组下标 (pre-existing latent bug exposed by virtual addition)".

- [ ] **Step 11.4: Commit spec update**

```bash
git add docs/superpowers/specs/2026-09-09-divergence-default-original-unit-design.md
git commit -m "docs(spec): note pre-existing onSelectCandidate index bug, fix in S3"
```

---

## Self-Review

**Spec coverage:**
- §3.1 数据形状 → Task 2 (helper)
- §3.2.1 helper → Task 1 + Task 2
- §3.2.2 diverge() 调用点改造 → Task 3
- §3.2.3 select_unit 端点不改 → confirmed (no task; verified during planning)
- §3.2.4 _build_commit_user_prompt 跳空 chain_reaction → Task 4
- §3.3.1 partitionOriginalCandidate helper → Task 6
- §3.3.2 渲染改造 → Task 7
- §3.3.3 select_unit 调用 → Task 5 (fix pre-existing bug)
- §3.3.4 默认选中(不改) → confirmed (no task)
- §3.4 状态生命周期 → Task 8 (legacy auto-trigger)
- §3.5 错误处理 → implicit (helper unit tests cover empty case in Task 1)
- §4.1 单元测试 → Task 1, Task 6
- §4.2 集成测试 → Task 9
- §4.3 E2E 烟雾测试 → Task 10

**Placeholder scan:** No "TBD" / "TODO" / "implement later" / vague phrases. All steps have concrete code or commands. Where existing project conventions needed matching (e.g., parent hook signature in Task 8), the step explicitly says "read the surrounding X lines first" — not a placeholder, just guidance.

**Type / signature consistency:**
- `partitionOriginalCandidate(candidates) → { original, others }` — defined Task 6, used Task 7 ✓
- `_append_original_candidate(unit, llm_candidates) → list[UnitCandidate]` — defined Task 2, used Task 3 ✓
- `onSelectCandidate(unitId, candidateIndex)` — current signature preserved; only the value passed at call site changes (Task 5) ✓
- `isOriginal?: boolean` prop on `CandidateRow` — added Task 7 ✓

**No issues found inline; plan ready for execution.**