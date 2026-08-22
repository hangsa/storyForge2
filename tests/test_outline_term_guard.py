"""Tests for backend.conductor.outline_term_guard.

The guard scans a generated outline dict for xianxia cultivation tropes
that are absent from the declared world.json's power-system stages. The
soft-constraint prompt fix (commit de50767) can still leak terms — this
is the post-merge safety net.

Surfaced on proj_1a7d7fcf where the world defines 建木灵种修行体系
(stages: 种心/生根/化形/觉醒/通神/证道/合道) and 古修体系 (见微/纳息/
通窍/化意/载道/同尘/真一), yet Volume 1's summary mentioned
'一剑斩灭元婴级追兵' — a stage the project doesn't allow.
"""
from __future__ import annotations

import pytest

from backend.conductor.outline_term_guard import (
    ForbiddenTerm,
    scan_outline_for_forbidden_terms,
)


def _world(stages_lists: list[list[str]] | None = None) -> dict:
    """Build a minimal world.json-shaped dict for tests. Two systems by
    default — the proj_1a7d7fcf shape that surfaced the bug."""
    if stages_lists is None:
        stages_lists = [
            ["种心", "生根", "化形", "觉醒", "通神", "证道", "合道"],
            ["见微", "纳息", "通窍", "化意", "载道", "同尘", "真一"],
        ]
    return {
        "era": "测试纪元",
        "power_systems": [
            {"name": f"体系{i+1}", "stages": stages} for i, stages in enumerate(stages_lists)
        ],
        "core_rules": [],
    }


# === Baseline: xianxia tropes are forbidden ===

@pytest.mark.parametrize("term", [
    "元婴", "金丹", "筑基", "化神", "结丹", "渡劫", "大乘", "练气",
])
def test_baseline_terms_are_detected(term):
    """Each term from the YAML hard-constraint list must be caught."""
    outline = {"volumes": [{"name": "第一卷", "summary": f"主角突破至{term}级"}]}
    violations = scan_outline_for_forbidden_terms(outline, _world())
    assert len(violations) == 1
    assert violations[0].term == term


def test_baseline_term_with_compound_suffix_is_detected():
    """元婴级 / 金丹期 / 筑基境 etc. — the term appears with a suffix."""
    outline = {"volumes": [{"summary": "主角以一剑斩灭元婴级追兵"}]}
    violations = scan_outline_for_forbidden_terms(outline, _world())
    assert any(v.term == "元婴" for v in violations)


# === Negative cases: legitimate content is NOT flagged ===

def test_world_stages_are_not_flagged():
    """The stages declared in world.json are allowed — guard must not
    regress those into violations."""
    outline = {
        "volumes": [{"summary": "主角从种心一路修至通神，最终合道"}],
        "mc_growth_arc": [{"description": "踏入载道门槛"}],
    }
    violations = scan_outline_for_forbidden_terms(outline, _world())
    assert violations == []


def test_system_names_are_not_flagged():
    """power_systems[*].name entries ('建木灵种修行体系' etc.) and
    generic cultivation words like '修行' must not trigger."""
    outline = {
        "core_conflict_theme": "建木灵种与古修之争",
        "volumes": [{"summary": "修行之路，强者为尊"}],
    }
    violations = scan_outline_for_forbidden_terms(outline, _world())
    assert violations == []


def test_empty_outline_returns_no_violations():
    assert scan_outline_for_forbidden_terms({}, _world()) == []


def test_outline_without_world_stages_uses_baseline_only():
    """When world.json has no power_systems at all, the baseline list
    alone must still guard."""
    world = {"era": "未知", "core_rules": []}  # no power_systems key
    outline = {"volumes": [{"summary": "主角渡劫失败"}]}
    violations = scan_outline_for_forbidden_terms(outline, world)
    assert any(v.term == "渡劫" for v in violations)


# === Path tracking ===

def test_violation_path_points_to_correct_field():
    """violation.path tells callers exactly where the term landed —
    required for actionable 422 responses."""
    outline = {
        "volumes": [
            {"name": "第一卷", "summary": "觉醒篇"},
            {"name": "第二卷", "summary": "主角遭遇元婴修士"},
        ],
    }
    violations = scan_outline_for_forbidden_terms(outline, _world())
    assert len(violations) == 1
    assert violations[0].path == "volumes[1].summary"


def test_nested_chapter_scene_path():
    """outline.json: chapters[N].scenes[M].conflict"""
    outline = {
        "chapters": [
            {
                "chapter_number": 5,
                "scenes": [
                    {"scene_number": 1, "conflict": "与结丹期对手交战"},
                    {"scene_number": 2, "conflict": "脱险"},
                ],
            },
        ],
    }
    violations = scan_outline_for_forbidden_terms(outline, _world())
    assert len(violations) == 1
    assert violations[0].path == "chapters[0].scenes[0].conflict"


# === Multiple violations, de-duplication of identical (path, term) ===

def test_multiple_violations_all_returned():
    outline = {
        "volumes": [
            {"summary": "元婴级追兵"},
            {"summary": "金丹期高手"},
        ],
        "mc_growth_arc": [{"description": "目标：化神"}],
    }
    violations = scan_outline_for_forbidden_terms(outline, _world())
    terms = {v.term for v in violations}
    assert terms == {"元婴", "金丹", "化神"}
    assert len(violations) == 3


# === API ===

def test_forbidden_term_dataclass_carries_snippet():
    """violation.snippet is a short context excerpt for the error message."""
    outline = {"volumes": [{"summary": "高阳体内斧影觉醒，一击斩灭元婴级追兵"}]}
    [v] = scan_outline_for_forbidden_terms(outline, _world())
    assert v.term == "元婴"
    assert v.path == "volumes[0].summary"
    assert "元婴" in v.snippet


# === Numeric / non-string fields are skipped ===

def test_numeric_and_null_fields_are_skipped():
    outline = {
        "chapter_number": 1,  # int — no scan
        "volumes": [{"name": "第一卷"}],  # no forbidden terms
    }
    violations = scan_outline_for_forbidden_terms(outline, _world())
    assert violations == []
