"""Tests for the four 3B creativity-law prompt YAML files.

Each of the four YAML files (three_b_breaking / three_b_bending / three_b_blending /
three_b_commit) is a single prompt template consumed by ThreeBEngine via
`load_prompt_effective` from `backend.services.prompt_override_store`. They must
also auto-appear in the Prompt Plaza UI because Plaza discovers them via
`GlobalPromptOverrideStore._iter_yaml_files()`.

These tests lock in:
- File presence at the expected path
- Valid YAML + matching `name` field
- `negative_constraints: ""` as a top-level key (codebase convention)
- Required `{prompt}`, `{genre_primary}`, `{genre_secondary}` placeholders in
  `user_prompt_template` (commit also needs `{deepened_candidates_json}`)
- `{negative_constraints}` placeholder in `system_prompt`
- Plaza's `_iter_yaml_files()` discovers all four by stem
"""
from pathlib import Path

import pytest
import yaml

from backend.config import settings
from backend.services.global_prompt_override_store import (
    GlobalPromptOverrideStore,
    get_global_override_store,
    reset_global_override_store,
)


# --- Constants -----------------------------------------------------------------

EXPECTED_NAMES = ("three_b_breaking", "three_b_bending", "three_b_blending", "three_b_commit")

# Each of the 4 files uses these placeholders in `user_prompt_template`.
COMMON_USER_PLACEHOLDERS = ("{prompt}", "{genre_primary}", "{genre_secondary}")

# Sub-dimension count claimed in each prompt's system_prompt (sanity-check on
# the "N sub-dimensions" headline so a number drift is caught loudly).
EXPECTED_SUB_DIMENSION_COUNT = {
    "three_b_breaking": 5,
    "three_b_bending": 6,
    "three_b_blending": 6,
}

# Names that look like 3B prompts but are NOT part of this batch.
NON_THREE_B_NAMES = (
    "creative_director_direction",
    "creative_director_mutation",
    "creative_director_path",
    "contradiction_expand",
    "genre_fusion",
    "mutation_operation",
    "novelty_evaluation_llm",
    "trope_extraction",
    "whatif_expand",
)


# --- Fixtures / helpers --------------------------------------------------------


def _prompts_dir() -> Path:
    return Path(settings.prompts_dir)


def _path_for(name: str) -> Path:
    return _prompts_dir() / "creative" / f"{name}.yaml"


@pytest.fixture(scope="module")
def prompts_dir() -> Path:
    return _prompts_dir()


@pytest.fixture(scope="module")
def all_yaml_data(prompts_dir) -> dict[str, dict]:
    """Load every 3B YAML once and return {name: parsed_dict}."""
    out: dict[str, dict] = {}
    for name in EXPECTED_NAMES:
        path = _path_for(name)
        if not path.exists():
            # Skip silently; the dedicated existence test will fail loudly.
            continue
        with open(path, "r", encoding="utf-8") as f:
            out[name] = yaml.safe_load(f) or {}
    return out


@pytest.fixture
def reset_plaza_store():
    """Reset the GlobalPromptOverrideStore singleton before each Plaza test.

    The singleton caches `prompts_dir` from settings at first call. Tests
    elsewhere in this repo can mutate settings, so reset before each Plaza test
    to guarantee we re-resolve from current settings.
    """
    reset_global_override_store()
    yield
    reset_global_override_store()


# --- Existence / parseability -------------------------------------------------


@pytest.mark.parametrize("name", EXPECTED_NAMES)
def test_yaml_file_exists(name: str):
    path = _path_for(name)
    assert path.exists(), f"Missing prompt YAML at {path}"
    assert path.is_file(), f"{path} exists but is not a regular file"


@pytest.mark.parametrize("name", EXPECTED_NAMES)
def test_yaml_parses_with_expected_name(name: str):
    path = _path_for(name)
    with open(path, "r", encoding="utf-8") as f:
        data = yaml.safe_load(f)
    assert isinstance(data, dict), f"{path.name} must parse to a mapping"
    assert data.get("name") == name, (
        f"{path.name}: 'name' field must equal {name!r}, got {data.get('name')!r}"
    )


# --- Structural keys -----------------------------------------------------------


@pytest.mark.parametrize("name", EXPECTED_NAMES)
def test_yaml_has_negative_constraints_top_level(name: str, all_yaml_data):
    data = all_yaml_data.get(name)
    assert data is not None, f"{name}.yaml missing — see test_yaml_file_exists"
    assert "negative_constraints" in data, (
        f"{name}.yaml must define top-level 'negative_constraints' key "
        "(codebase convention; consumed by load_prompt_effective)"
    )
    assert data["negative_constraints"] == "", (
        f"{name}.yaml: 'negative_constraints' must default to empty string "
        "so per-project overrides can replace it"
    )


@pytest.mark.parametrize("name", EXPECTED_NAMES)
def test_yaml_has_system_and_user_prompt_keys(name: str, all_yaml_data):
    data = all_yaml_data.get(name)
    assert data is not None
    assert "system_prompt" in data, f"{name}.yaml must define 'system_prompt'"
    assert "user_prompt_template" in data, (
        f"{name}.yaml must define 'user_prompt_template'"
    )
    assert isinstance(data["system_prompt"], str)
    assert isinstance(data["user_prompt_template"], str)
    assert data["system_prompt"].strip(), (
        f"{name}.yaml: 'system_prompt' must not be empty"
    )
    assert data["user_prompt_template"].strip(), (
        f"{name}.yaml: 'user_prompt_template' must not be empty"
    )


# --- Placeholder checks --------------------------------------------------------


@pytest.mark.parametrize("name", EXPECTED_NAMES)
def test_system_prompt_contains_negative_constraints_placeholder(name: str, all_yaml_data):
    data = all_yaml_data.get(name)
    assert data is not None
    assert "{negative_constraints}" in data["system_prompt"], (
        f"{name}.yaml: 'system_prompt' must reference {{negative_constraints}} "
        "so per-project constraints can be injected"
    )


@pytest.mark.parametrize("name", EXPECTED_NAMES)
@pytest.mark.parametrize("placeholder", COMMON_USER_PLACEHOLDERS)
def test_user_prompt_template_has_common_placeholder(
    name: str, placeholder: str, all_yaml_data
):
    data = all_yaml_data.get(name)
    assert data is not None
    assert placeholder in data["user_prompt_template"], (
        f"{name}.yaml: 'user_prompt_template' must contain {placeholder}"
    )


def test_commit_user_prompt_template_has_deepened_candidates_json(all_yaml_data):
    """Only three_b_commit needs {deepened_candidates_json} — the other 3
    operate on the raw {prompt} and don't see per-candidate detail."""
    data = all_yaml_data.get("three_b_commit")
    assert data is not None
    assert "{deepened_candidates_json}" in data["user_prompt_template"], (
        "three_b_commit.yaml: user_prompt_template must contain "
        "{deepened_candidates_json} (Stage-3 synthesis consumes per-candidate "
        "premise/rationale/novelty_hook)"
    )


@pytest.mark.parametrize("name", ("three_b_breaking", "three_b_bending", "three_b_blending"))
def test_stage_user_prompts_do_not_reference_deepened_candidates(name: str, all_yaml_data):
    """Inverse of the commit test: Stage 1/2 prompts receive only the raw
    prompt, not the per-candidate JSON. If someone copy-pastes the commit
    template into a stage prompt by accident, this test catches it."""
    data = all_yaml_data.get(name)
    assert data is not None
    assert "{deepened_candidates_json}" not in data["user_prompt_template"], (
        f"{name}.yaml: Stage-1/2 prompts must NOT reference "
        "{{deepened_candidates_json}} — only Stage 3 (commit) consumes the "
        "deepened candidate list"
    )


# --- Sub-dimension count sanity ------------------------------------------------


@pytest.mark.parametrize("name", list(EXPECTED_SUB_DIMENSION_COUNT))
def test_system_prompt_advertises_expected_sub_dimension_count(name: str, all_yaml_data):
    """Sanity-check the headline count (5 / 6 / 6) so the LLM instruction stays
    consistent with the JSON example it asks the model to emit."""
    expected = EXPECTED_SUB_DIMENSION_COUNT[name]
    data = all_yaml_data.get(name)
    assert data is not None
    sys = data["system_prompt"]
    # The system prompt enumerates sub-dimensions as "1. ... 2. ... N. ..." in
    # numbered headings. We check that the N-th sub-dimension heading exists.
    needle = f"{expected}. **"
    assert needle in sys, (
        f"{name}.yaml: system_prompt must enumerate {expected} sub-dimensions; "
        f"expected to find heading {needle!r}"
    )


# --- Plaza auto-discovery ------------------------------------------------------


def test_plaza_discovers_all_four_three_b_prompts(reset_plaza_store):
    """`GlobalPromptOverrideStore._iter_yaml_files()` is the same recursive
    YAML scan that Prompt Plaza's list endpoint uses. All four 3B prompts must
    show up by stem (no extra registration step)."""
    store = get_global_override_store()
    discovered_names = {path.stem for path, _category in store._iter_yaml_files()}

    for name in EXPECTED_NAMES:
        assert name in discovered_names, (
            f"GlobalPromptOverrideStore did not discover {name}.yaml — "
            "Plaza UI will not list this template. Check that the file lives "
            "under settings.prompts_dir (not deeper than 2 levels) and ends "
            "in .yaml."
        )


def test_plaza_discovery_uses_settings_prompts_dir(reset_plaza_store):
    """Discovery must follow settings.prompts_dir (not a hard-coded path),
    so that test/dev/prod environments can override it via backend/.env."""
    store = get_global_override_store()
    assert Path(store.prompts_dir).resolve() == Path(settings.prompts_dir).resolve(), (
        f"GlobalPromptOverrideStore.prompts_dir ({store.prompts_dir}) must "
        f"match settings.prompts_dir ({settings.prompts_dir})"
    )


def test_plaza_direct_construction_also_discovers_three_b(prompts_dir, tmp_path):
    """Build a fresh store from scratch (not the singleton) and verify
    discovery still finds the 3B prompts. Guards against future changes to
    the singleton wiring breaking the constructor path."""
    overrides_path = tmp_path / "global_prompt_overrides.json"
    store = GlobalPromptOverrideStore(
        global_overrides_path=overrides_path,
        prompts_dir=prompts_dir,
    )
    discovered_names = {path.stem for path, _category in store._iter_yaml_files()}
    for name in EXPECTED_NAMES:
        assert name in discovered_names, (
            f"Fresh GlobalPromptOverrideStore did not discover {name}.yaml "
            "via direct construction"
        )


def test_plaza_list_available_returns_three_b_entries(reset_plaza_store):
    """`list_available()` is the actual API Plaza calls. It returns dicts
    with `name`, `category`, `label`, etc. — verify the 3B entries land in
    the response with `category == "creative"` (matches the file layout)."""
    store = get_global_override_store()
    entries = store.list_available()
    by_name = {entry["name"]: entry for entry in entries}

    for name in EXPECTED_NAMES:
        assert name in by_name, (
            f"GlobalPromptOverrideStore.list_available() did not include {name}"
        )
        assert by_name[name]["category"] == "creative", (
            f"{name} must be categorized as 'creative' (subdir under prompts_dir)"
        )
        assert by_name[name]["builtin"] is True


def test_plaza_three_b_get_effective_round_trip(reset_plaza_store):
    """`get_effective(name)` is what the engine ultimately calls. Verify it
    returns a usable dict for each of the four 3B prompts (no FileNotFoundError,
    no empty body)."""
    store = get_global_override_store()
    for name in EXPECTED_NAMES:
        eff = store.get_effective(name)
        assert isinstance(eff, dict), f"get_effective({name!r}) must return a dict"
        assert eff.get("name") == name
        assert eff.get("system_prompt"), (
            f"get_effective({name!r}) returned empty system_prompt"
        )
        assert eff.get("user_prompt_template"), (
            f"get_effective({name!r}) returned empty user_prompt_template"
        )


def test_load_prompt_effective_resolves_subdir_three_b_by_bare_stem(reset_plaza_store):
    """Regression for 2026-09-06 Plaza bug: per-project Plaza's `get_prompt`
    called `load_prompt_effective("three_b_breaking")` which routed through
    `_load_yaml_prompt` with direct-path-only matching. That raised
    FileNotFoundError because `three_b_breaking.yaml` only exists under
    `creative/`, returning a 404 ("Prompt template not found") to the UI.

    After the fix `_load_yaml_prompt` falls back to a recursive walk when the
    direct path is absent, so bare-stem lookups resolve subdir files. The
    engine itself was also switched to bare stems (`three_b_breaking` instead
    of `creative/three_b_breaking`) so the override JSON key Plaza saves under
    matches what the engine reads back — otherwise user edits silently had no
    effect at runtime.
    """
    from backend.services.prompt_override_store import load_prompt_effective

    for name in EXPECTED_NAMES:
        eff = load_prompt_effective(name)
        assert isinstance(eff, dict), f"load_prompt_effective({name!r}) must return a dict"
        assert eff.get("name") == name, (
            f"load_prompt_effective({name!r}) returned name={eff.get('name')!r}; "
            "expected the engine-canonical stem so Plaza override keys align"
        )
        assert eff.get("system_prompt"), (
            f"load_prompt_effective({name!r}) returned empty system_prompt"
        )


def test_load_prompt_effective_prefers_root_for_duplicate_basenames(reset_plaza_store):
    """`trope_extraction.yaml` exists at both root and `creative/`. The
    engine calls bare-stem `load_prompt_effective("trope_extraction")` and
    expects the root copy (claude-haiku-4-5 + 2000 tokens). The direct-path
    fast path in `_load_yaml_prompt` keeps that contract; the recursive
    fallback (which sorts alphabetically and would pick `creative/` first)
    must NOT override it for files that DO exist at root."""
    from backend.services.prompt_override_store import load_prompt_effective

    eff = load_prompt_effective("trope_extraction")
    assert eff.get("model") == "claude-haiku-4-5-20251001", (
        "Bare-stem `trope_extraction` must resolve to root copy "
        f"(got model={eff.get('model')!r})"
    )
    assert eff.get("max_tokens") == 2000, (
        "Bare-stem `trope_extraction` must resolve to root copy "
        f"(got max_tokens={eff.get('max_tokens')!r})"
    )


# --- Negative: other prompts must not be confused with 3B ----------------------


@pytest.mark.parametrize("name", NON_THREE_B_NAMES)
def test_other_creative_prompts_are_not_in_three_b_set(name: str):
    """Cross-check: none of the unrelated creative/ prompts should match the
    3B name set. Catches accidental collision if someone renames a YAML."""
    assert name not in EXPECTED_NAMES, (
        f"{name} is a creative prompt but must not collide with the 3B set"
    )


# --- three_b_decompose (Stage 1→2 prompt, added in rewrite Task 10) -----------


def test_three_b_decompose_yaml_exists():
    from pathlib import Path
    p = Path("backend/prompts/creative/three_b_decompose.yaml")
    assert p.exists(), f"{p} 不存在"


def test_three_b_decompose_yaml_schema():
    import yaml
    from pathlib import Path
    p = Path("backend/prompts/creative/three_b_decompose.yaml")
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    assert data["name"] == "three_b_decompose"
    assert "5 维度" in data["system_prompt"] or "ontology" in data["system_prompt"].lower()
    assert "{prompt}" in data["user_prompt_template"]
    assert "causal_map" in data["system_prompt"] or "causal_map" in data["user_prompt_template"]
    assert "top_level_summary" in data["system_prompt"] or "top_level_summary" in data["user_prompt_template"]


# --- three_b_adaptive_diverge (Stage 2→3 prompt, added in rewrite Task 11) -----


def test_three_b_adaptive_diverge_yaml_exists():
    from pathlib import Path
    p = Path("backend/prompts/creative/three_b_adaptive_diverge.yaml")
    assert p.exists()


def test_three_b_adaptive_diverge_yaml_includes_4_operators_and_chain_reaction():
    import yaml
    from pathlib import Path
    p = Path("backend/prompts/creative/three_b_adaptive_diverge.yaml")
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    content = data["system_prompt"] + data["user_prompt_template"]
    for op in ("扭曲", "打破", "融合", "组合链"):
        assert op in content, f"算子 {op} 不在 prompt 中"
    assert "chain_reaction" in content
    assert "{unit_name}" in data["user_prompt_template"]
    assert "{unit_description}" in data["user_prompt_template"]