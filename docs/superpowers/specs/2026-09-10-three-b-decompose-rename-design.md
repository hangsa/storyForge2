# Rename prompt `three_b_decompose` → `firstness_decompose`

Date: 2026-09-10
Status: Approved (brainstorming, 2026-09-10)
Scope: single-file rename of one prompt identifier

## Motivation

The prompt currently named `three_b_decompose` performs first-principles decomposition
("将任何给定的创意点子,按第一性原理拆解至不可再分的基本单元"). The original name reflected
the 3B brainstorm-family origin; the new name reflects what the prompt actually does.
Other prompts in the family (`three_b_adaptive_diverge`, `three_b_commit`,
`three_b_follow_up`) keep their names — only this one is being renamed.

## Scope (locked)

Only the prompt identifier is renamed:
- YAML file path
- YAML `name:` field
- Engine constant value
- Test references (assertions + function names + Path strings)

Everything else stays as-is.

## Identifiers to change

| Location | Current | New |
|---|---|---|
| File path | `backend/prompts/creative/three_b_decompose.yaml` | `backend/prompts/creative/firstness_decompose.yaml` |
| YAML `name:` (line 1) | `name: three_b_decompose` | `name: firstness_decompose` |
| Engine constant `backend/creative_os/three_b_engine.py:50` | `DECOMPOSE_PROMPT = "three_b_decompose"` | `DECOMPOSE_PROMPT = "firstness_decompose"` |

## Tests to update (`backend/tests/test_three_b_yaml.py`)

- L6 comment: `three_b_decompose` → `firstness_decompose`
- L40 set/list entry: `"three_b_decompose"` → `"firstness_decompose"`
- L313 section header comment
- L316 test function `test_three_b_decompose_yaml_exists` → `test_firstness_decompose_yaml_exists`
- L318 / L322 / L325 `Path("backend/prompts/creative/three_b_decompose.yaml")` → `…/firstness_decompose.yaml`
- L327 `assert data["name"] == "three_b_decompose"` → `== "firstness_decompose"`
- L394 set membership: `"three_b_decompose"` → `"firstness_decompose"`

## What stays

- Sibling prompts: `three_b_adaptive_diverge.yaml`, `three_b_commit.yaml`, `three_b_follow_up.yaml`
- Module / route / state names: `three_b_engine.py`, `three_b_routes.py`, `three_b_state.json`, `agent_name="three_b"`
- All `docs/superpowers/{specs,plans}/*.md` (frozen historical records)
- `config/global_prompt_overrides.json` (verified clean)
- No per-project prompt overrides (verified clean)

## Verification

1. `pytest backend/tests/test_three_b_yaml.py` — all pass
2. `pytest backend/tests/test_api/test_three_b_routes.py` — pass (routes load via `DECOMPOSE_PROMPT` constant)
3. `grep -rn "three_b_decompose" backend/` — returns zero hits
4. Manual smoke: backend boots, divergence_v2 wizard S2 (decompose) still produces the 5-dim JSON output
5. `grep -rn "firstness_decompose" backend/` — returns the expected 3+ hits (YAML name + constant + tests)

## Risks checked

- **Prompt Plaza override orphans:** none (verified empty for both names)
- **Project state files:** state schema references engine state, not prompt names
- **Frontend:** zero references under `frontend/`
- **Naming collision:** `firstness_decompose` does not exist anywhere yet (verified)
- **No backwards-compat shim** — YAGNI; no external consumer

## Out of scope (explicit)

- Renaming sibling prompts
- Renaming engine module / route / state files
- Rewriting historical spec/plan docs
- Adding a backward-compat alias for the old name