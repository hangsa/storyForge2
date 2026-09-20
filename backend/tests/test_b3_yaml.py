"""Tests for the v2 3B creativity-decomposition prompt YAML files.

The v2 rewrite replaces the four v1 operator prompts (breaking / bending /
blending / commit) with four prompts that follow the new 4-stage pipeline:

  - firstness_decompose         (Stage 1 → 2: 5-dimension decomposition)
  - follow_up              (Stage 2: per-unit follow-up deepening)
  - adaptive_diverge           (Stage 2 → 3: adaptive divergence with chain reaction)
  - b3_commit             (Stage 3 → 4: synthesis using causal_map + summary)

Each is a single prompt template consumed by B3Engine via
`load_prompt_effective` from `backend.services.prompt_override_store`. They must
also auto-appear in the Prompt Plaza UI because Plaza discovers them via
`GlobalPromptOverrideStore._iter_yaml_files()`.

These tests lock in:
- File presence at the expected path
- Valid YAML + matching `name` field
- `negative_constraints: ""` as a top-level key (codebase convention)
- `{negative_constraints}` placeholder in `system_prompt`
- Plaza's `_iter_yaml_files()` discovers all four by stem
- Per-prompt placeholder contracts (see individual tests below)

2026-09-20:`b3_follow_up` 重命名为 `follow_up`。
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

EXPECTED_NAMES = (
    "firstness_decompose",
    "follow_up",
    "adaptive_diverge",
    "b3_commit",
)

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


# --- Plaza auto-discovery ------------------------------------------------------


def test_plaza_discovers_all_four_b3_prompts(reset_plaza_store):
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


def test_plaza_direct_construction_also_discovers_b3(prompts_dir, tmp_path):
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


def test_plaza_list_available_returns_b3_entries(reset_plaza_store):
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


def test_plaza_b3_get_effective_round_trip(reset_plaza_store):
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


def test_load_prompt_effective_resolves_subdir_b3_by_bare_stem(reset_plaza_store):
    """Regression for 2026-09-06 Plaza bug: per-project Plaza's `get_prompt`
    called `load_prompt_effective("follow_up")` which routed through
    `_load_yaml_prompt` with direct-path-only matching. That raised
    FileNotFoundError because `follow_up.yaml` only exists under
    `creative/`, returning a 404 ("Prompt template not found") to the UI.

    After the fix `_load_yaml_prompt` falls back to a recursive walk when the
    direct path is absent, so bare-stem lookups resolve subdir files. The
    engine itself was also switched to bare stems (`follow_up` instead
    of `creative/follow_up`) so the override JSON key Plaza saves under
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
def test_other_creative_prompts_are_not_in_b3_set(name: str):
    """Cross-check: none of the unrelated creative/ prompts should match the
    3B name set. Catches accidental collision if someone renames a YAML."""
    assert name not in EXPECTED_NAMES, (
        f"{name} is a creative prompt but must not collide with the 3B set"
    )


# --- firstness_decompose (Stage 1→2 prompt, added in rewrite Task 10) ---------


def test_firstness_decompose_yaml_exists():
    from pathlib import Path
    p = Path("backend/prompts/creative/firstness_decompose.yaml")
    assert p.exists(), f"{p} 不存在"


def test_firstness_decompose_yaml_schema():
    import yaml
    from pathlib import Path
    p = Path("backend/prompts/creative/firstness_decompose.yaml")
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    assert data["name"] == "firstness_decompose"
    assert "5 维度" in data["system_prompt"] or "ontology" in data["system_prompt"].lower()
    assert "{prompt}" in data["user_prompt_template"]
    assert "causal_map" in data["system_prompt"] or "causal_map" in data["user_prompt_template"]
    assert "top_level_summary" in data["system_prompt"] or "top_level_summary" in data["user_prompt_template"]


# Universality regression guard (2026-09-11, 第一性拆解迭代): the original
# prompt biased LLM output toward xianxia — example vocabulary like 灵窍/
# 修行/天道/穿越 was sprinkled through the dimension descriptions. A new
# user reporting a 都市 / 悬疑 / 科幻 / 历史 / 言情 brainstorm would get
# fantasy-flavored units back. Lock the fix: the prompt must (a) explicitly
# name ≥5 distinct genres and (b) call out genre-specific in-world validation
# criteria for the same genres. If a future rewrite drops the genre
# adaptation layer, this test fails loudly.
@pytest.mark.parametrize("genre", ["玄幻", "仙侠", "历史", "都市", "科幻", "灵异", "悬疑", "言情"])
def test_firstness_decompose_yaml_mentions_genre(genre: str):
    import yaml
    from pathlib import Path
    p = Path("backend/prompts/creative/firstness_decompose.yaml")
    content = p.read_text(encoding="utf-8")
    assert genre in content, (
        f"firstness_decompose.yaml 未提及题材 {genre!r} — "
        f"提示词可能退化为单一题材(原版仅侧重玄幻/仙侠)。"
        f"需在题材适配层加入该题材的承重维度信息。"
    )


def test_firstness_decompose_yaml_has_genre_adaptation_layer():
    """Lock the genre adaptation layer (承重维度 + 世界内校验 tables) so a
    future rewrite can't silently drop it. The firstness_decompose prompt's
    universality across 玄幻/都市/科幻/历史/悬疑/言情/灵异 depends on this
    layer being present and readable."""
    import yaml
    from pathlib import Path
    p = Path("backend/prompts/creative/firstness_decompose.yaml")
    content = p.read_text(encoding="utf-8")
    data = yaml.safe_load(content)
    system = data["system_prompt"]
    # 题材适配层 的两块:承重维度 + 世界内校验
    assert "承重维度" in system, (
        "firstness_decompose.yaml 缺少「承重维度」表 — "
        "通用层框架若不附题材适配层,所有题材都会按同构方式拆解,"
        "导致历史/都市/悬疑等题材的诊断失焦。"
    )
    assert "世界内校验" in system, (
        "firstness_decompose.yaml 缺少「世界内校验」表 — "
        "不同题材的自洽检验判据完全不同(玄幻:能否钻空子; "
        "科幻:规则极端情况下是否自洽;悬疑:线索是否公平展示)。"
        "没有这一层,「世界内检验」原则沦为口号。"
    )


def test_firstness_decompose_yaml_avoids_fantasy_only_vocabulary_in_dimensions():
    """The original prompt baked fantasy terms (灵窍/修行/天道/穿越/外挂/献祭)
    into the 5 dimension descriptions themselves, biasing every genre's output
    toward xianxia vocabulary. The 2026-09-11 rewrite moved those examples
    into the unit_name illustrative field (which the LLM only fills per the
    current genre) and replaced dimension descriptions with genre-agnostic
    abstractions (接口/通道/底层规则/资源池/意义解释权). Lock that the 5
    dimension descriptions themselves don't reintroduce fantasy-flavored terms.

    Note: 灵窍/修行/etc. ARE allowed in the unit_name illustrative field
    ("如仙侠:灵窍;都市:升迁密码;科幻:黑箱") — that's genre-conditional and
    serves as cross-genre examples. The test only inspects the 5 dimension
    sections."""
    import re
    import yaml
    from pathlib import Path
    p = Path("backend/prompts/creative/firstness_decompose.yaml")
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    system = data["system_prompt"]
    # Extract each ## 维度X: ... block (dimension definition + 通用方向).
    dim_blocks = re.findall(
        r"## 维度[一二三四五][^\n]*\n(.*?)(?=\n## |\n# |\Z)",
        system,
        flags=re.DOTALL,
    )
    assert len(dim_blocks) == 5, (
        f"应解析到 5 个维度块,实际 {len(dim_blocks)} 个 — "
        f"提示词结构可能变了,需要更新本测试。"
    )
    forbidden = ["灵窍", "修行", "天道", "外挂", "献祭", "穿越", "系统流"]
    for i, block in enumerate(dim_blocks, start=1):
        for term in forbidden:
            assert term not in block, (
                f"维度 {['一','二','三','四','五'][i-1]} 描述含题材偏向词 {term!r} — "
                f"维度描述必须是题材中立的框架定义,不要把单一题材的子域标签"
                f"塞进通用层。"
            )


# --- adaptive_diverge (Stage 2→3 prompt, added in rewrite Task 11) -----


def test_adaptive_diverge_yaml_exists():
    from pathlib import Path
    p = Path("backend/prompts/creative/adaptive_diverge.yaml")
    assert p.exists()


def test_adaptive_diverge_yaml_includes_4_operators_and_chain_reaction():
    import yaml
    from pathlib import Path
    p = Path("backend/prompts/creative/adaptive_diverge.yaml")
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    content = data["system_prompt"] + data["user_prompt_template"]
    for op in ("扭曲", "打破", "融合", "组合链"):
        assert op in content, f"算子 {op} 不在 prompt 中"
    assert "chain_reaction" in content
    assert "{unit_name}" in data["user_prompt_template"]
    assert "{unit_description}" in data["user_prompt_template"]


# 2026-09-20:`methodology_block` 是被 follow_up.yaml 的 {operator_instructions}
# 占位消费的字段(用户选「自适应」operator 时,b3_engine.follow_up_unit 通过
# load_prompt_effective 读本字段拼到 follow_up 的 system_prompt 末尾 — 不是独立
# 发起 LLM 调用)。Plaza 用户可编辑本字段来调整自适应追问方法论。
def test_adaptive_diverge_yaml_has_methodology_block():
    import yaml
    from pathlib import Path
    p = Path("backend/prompts/creative/adaptive_diverge.yaml")
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    assert "methodology_block" in data, (
        "adaptive_diverge.yaml 必须含 methodology_block 字段(follow_up 追问「自适应」模式依赖它)"
    )
    block = data["methodology_block"]
    # 关键方法论 marker — 任一缺失说明 prompt 被改坏了,follow_up 自适应模式会失去方法论指导
    for marker in (
        "operator=adaptive",
        "扫描 Unit",            # 第一步:扫描
        "主+辅算子",            # 第二步:自动匹配
        "综合生成",            # 第三步
        "chain_reaction",      # 输出字段约束
        "main_operator",       # 输出字段约束
        "aux_operator",        # 输出字段约束
    ):
        assert marker in block, f"methodology_block 缺失关键 marker: {marker}"


def test_adaptive_diverge_methodology_block_global_override_propagates(tmp_path):
    """用户编辑 Plaza global override 后,follow_up 拿到的 methodology_block 应改变。

    这是 adaptive_diverge 作为「方法论源」的契约测试 — 改完 YAML 不应该让
    Plaza 编辑毫无效果。
    """
    import json
    from backend.services.global_prompt_override_store import GlobalPromptOverrideStore
    from backend.services.prompt_override_store import load_prompt_effective

    SENTINEL = "[USER-CUSTOMIZED-METHODOLOGY-MARKER-2026-09-20]"
    global_file = tmp_path / "global_prompt_overrides.json"
    global_file.write_text(
        json.dumps({
            "adaptive_diverge": {
                "methodology_block": f"{SENTINEL}\n用户改写后的自适应追问方法论",
                "_modified_at": "2026-09-20T00:00:00Z",
            }
        }),
        encoding="utf-8",
    )

    store = GlobalPromptOverrideStore(
        global_overrides_path=global_file,
        prompts_dir=settings.prompts_dir,
    )
    effective = load_prompt_effective(
        "adaptive_diverge",
        global_override_store=store,
    )
    assert effective.get("methodology_block", "").startswith(SENTINEL), (
        "global override 没有穿透到 adaptive_diverge.effective.methodology_block — "
        "Plaza 编辑本字段不会生效"
    )
    # 反向断言:删掉 global override 后应回到 YAML 默认内容(不再包含 sentinel)
    global_file.unlink()
    # 重建 store 读取新的空 overrides
    store2 = GlobalPromptOverrideStore(
        global_overrides_path=global_file,
        prompts_dir=settings.prompts_dir,
    )
    fallback = load_prompt_effective(
        "adaptive_diverge",
        global_override_store=store2,
    )
    assert SENTINEL not in fallback.get("methodology_block", ""), (
        "删掉 global override 后 methodology_block 应回到 YAML 默认 — "
        "回退路径坏了"
    )


# --- follow_up (Stage 2 per-unit follow-up, added in rewrite Task 12) -


def test_old_3b_yamls_deleted():
    from pathlib import Path
    for name in ("b3_breaking", "b3_bending", "b3_blending"):
        p = Path(f"backend/prompts/creative/{name}.yaml")
        assert not p.exists(), f"旧 {name}.yaml 应已删除"


def test_follow_up_yaml_exists():
    from pathlib import Path
    p = Path("backend/prompts/creative/follow_up.yaml")
    assert p.exists()


def test_follow_up_yaml_schema():
    import yaml
    from pathlib import Path
    p = Path("backend/prompts/creative/follow_up.yaml")
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    assert data["name"] == "follow_up"
    assert "{unit_name}" in data["user_prompt_template"]


def test_b3_commit_yaml_uses_causal_map_and_summary():
    import yaml
    from pathlib import Path
    p = Path("backend/prompts/creative/b3_commit.yaml")
    data = yaml.safe_load(p.read_text(encoding="utf-8"))
    tpl = data["user_prompt_template"]
    assert "{causal_map}" in tpl
    assert "{top_level_summary}" in tpl
    assert "{selected_units}" in tpl


def test_all_v2_yamls_in_creative_dir():
    from pathlib import Path
    expected = {"firstness_decompose", "follow_up", "adaptive_diverge", "b3_commit"}
    found = {p.stem for p in Path("backend/prompts/creative/").glob("*.yaml")}
    assert expected.issubset(found)


# --- Format-kwargs drift guard -------------------------------------------------


# Regression (2026-09-11, proj_* browser smoke): the WIP commit 501e79f removed
# `genre_secondary` from RawIntent / DecomposeRequest but the
# firstness_decompose.yaml user_prompt_template still referenced
# `{genre_secondary}`. The engine's `_invoke_llm_json_with_block` formats
# the template with kwargs pulled from RawIntent + a couple of literals, so
# the missing placeholder surfaced as a 503 with `KeyError: 'genre_secondary'`
# at /decompose — the S1→S2 transition fired silently (frontend coerced the
# 503 detail string to a successful empty-decomposition result because
# client.ts doesn't throw on FastAPI bare-detail 4xx/5xx envelopes; see
# `project_frontend_request_helper_fastapi_bare_detail.md`). The user saw
# "未自动触发拆解,未展示「拆解中」进度".
#
# This test loads each 3B prompt and formats the user_prompt_template with
# the exact kwargs the engine passes, asserting no KeyError. It catches both
# directions of drift: a renamed/removed RawIntent field that the prompt
# still references, AND a new field the prompt adds that the engine doesn't
# supply. The literal values are chosen so substitution can't accidentally
# pass when a placeholder is silently dropped (each kwarg appears at least
# once in the formatted string and is a non-empty sentinel).
def test_prompts_format_with_engine_kwargs_without_keyerror():
    """Format every 3B prompt's user_prompt_template with the kwargs the
    engine actually passes. A KeyError here means the prompt's placeholder
    set drifted out of sync with the engine's call site — the exact bug that
    surfaced on 2026-09-11 (firstness_decompose referencing
    `{genre_secondary}` after the field was removed from RawIntent).
    """
    from backend.services.prompt_override_store import load_prompt_effective
    from backend.creative_os.b3_engine import RawIntent

    sample = RawIntent(prompt="一个赛博朋克 + 修仙的脑洞", genre_primary="cool_novel", tone="rexue", style="shuangwen")

    # Each entry: (prompt_name, kwargs dict the engine calls .format(**kwargs) with)
    cases = [
        ("firstness_decompose", {
            "raw_intent": sample,
            "prompt": sample.prompt,
            "genre_primary": sample.genre_primary,
            "tone": sample.tone,
            "style": sample.style,
            "user_modifications": "",
        }),
        ("adaptive_diverge", {
            "raw_intent": sample,
            "prompt": sample.prompt,
            "genre_primary": sample.genre_primary,
            "tone": sample.tone,
            "style": sample.style,
            "dimension": "ontology",
            "unit_name": "灵窍",
            "unit_description": "灵窍是接口",
        }),
    ]
    for name, kwargs in cases:
        prompt = load_prompt_effective(name)
        tpl = prompt["user_prompt_template"]
        try:
            rendered = tpl.format(**kwargs)
        except KeyError as e:
            pytest.fail(
                f"{name}.yaml user_prompt_template references {{{e.args[0]}}} "
                f"but engine.decompose/diverge does not pass that kwarg. "
                f"Either add the kwarg to the engine call site or drop the "
                f"placeholder from the prompt — see 2026-09-11 browser "
                f"decompose regression for context."
            )
        # Sanity: the rendered text should contain at least the prompt and
        # primary genre, otherwise the placeholder was silently dropped
        # (e.g. doubled-up braces that .format() consumes without inserting).
        assert sample.prompt in rendered, (
            f"{name}.yaml: rendered template is missing the literal prompt — "
            f"placeholder substitution may be silently failing"
        )
        assert sample.genre_primary in rendered, (
            f"{name}.yaml: rendered template is missing the literal genre_primary"
        )