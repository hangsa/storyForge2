"""Regression: world_generation.yaml user_prompt_template must format() cleanly.

2026-09-20 (proj_47738f64): the example JSON for core_rules used unescaped
{...} braces inside the user_prompt_template. str.format() interpreted
{"category": ...} as a placeholder named '"category"' and raised KeyError
on every regenerate. The whole prompt must format with the kwargs that
generate_world actually passes.
"""

from backend.services.prompt_override_store import load_prompt_effective

GENERATE_WORLD_KWARGS = {
    "concept_title": "",
    "concept_premise": "",
    "concept_tone": "",
    "concept_theme": "",
    "core_contradiction": "",
    "genre": "cool_novel",
    "genre_tone": "",
    "genre_style_rules": "",
    "genre_trope_patterns": "",
    "ontology_units": "",
    "energetics_units": "",
    "power_structure_units": "",
    "protagonist_engine_units": "",
    "narrative_physics_units": "",
    "causal_map": "",
    "user_modifications": "",
    "negative_constraints": "",
    "faction_only_index": "",   # 2026-09-20 新增 (sub-tab 重生单条势力用)
}


def test_world_generation_user_prompt_template_formats_cleanly():
    data = load_prompt_effective("world_generation")
    tmpl = data["user_prompt_template"]
    formatted = tmpl.format(**GENERATE_WORLD_KWARGS)
    # Every placeholder is substituted (no {placeholder} residue).
    assert "{ontology_units}" not in formatted
    assert "{narrative_physics_units}" not in formatted
    assert "{faction_only_index}" not in formatted   # 新增
    # The core_rules example survives format as a JSON-shape hint for the LLM.
    assert '{"category":' in formatted


def test_world_generation_user_prompt_template_handles_realistic_user_modifications():
    data = load_prompt_effective("world_generation")
    tmpl = data["user_prompt_template"]
    # user_modifications may contain JSON-shaped text that would break a
    # fragile template — e.g. a user pasting a literal {category: ...}.
    kwargs = dict(GENERATE_WORLD_KWARGS)
    kwargs["user_modifications"] = '示例 {"category": "physical", "text": "用户自定义"}'
    formatted = tmpl.format(**kwargs)
    assert "用户自定义" in formatted