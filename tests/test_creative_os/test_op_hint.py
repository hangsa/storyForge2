"""Verify compute_op_hint deterministic rules (spec §6.2)."""
from backend.creative_os.op_hint import compute_op_hint


def test_step_5_always_dramaturgy():
    hint = compute_op_hint({"novelty": 0.9}, [], step=5)
    assert hint == "dramaturgy"


def test_low_novelty_returns_twist():
    hint = compute_op_hint({"novelty": 0.3}, [], step=2)
    assert hint == "twist"


def test_no_conflict_returns_break():
    hint = compute_op_hint({"novelty": 0.6, "core_conflict": "一句话无冲突"}, [], step=2)
    assert hint == "break"


def test_single_genre_returns_fuse():
    hint = compute_op_hint(
        {"novelty": 0.7, "core_conflict": "有冲突"},
        [],
        step=2,
        genres=["xianxia"],
    )
    assert hint == "fuse"


def test_step_3_no_invert_in_path_returns_invert():
    hint = compute_op_hint(
        {"novelty": 0.7, "core_conflict": "有冲突", "conflict_scale": "social"},
        [{"operation": "twist"}, {"operation": "break"}],
        step=3,
        genres=["xianxia", "xuanyi"],
    )
    assert hint == "invert"


def test_personal_conflict_scale_returns_escalate():
    hint = compute_op_hint(
        {"novelty": 0.7, "core_conflict": "有冲突", "conflict_scale": "personal"},
        [{"operation": "twist"}],
        step=4,
        genres=["xianxia", "xuanyi"],
    )
    assert hint == "escalate"


def test_default_returns_twist():
    hint = compute_op_hint(
        {"novelty": 0.7, "core_conflict": "有冲突", "conflict_scale": "social"},
        [{"operation": "twist"}, {"operation": "invert"}, {"operation": "escalate"}],
        step=4,
        genres=["xianxia", "xuanyi"],
    )
    assert hint == "twist"


def test_empty_concept_returns_twist_fallback():
    hint = compute_op_hint({}, [], step=2)
    assert hint == "twist"  # defaults trigger fallback


def test_handles_missing_conflict_keywords():
    """No 冲突/矛盾 keywords → rule 3 fires → break."""
    hint = compute_op_hint(
        {"novelty": 0.6, "core_conflict": "主角的内心挣扎"},
        [], step=2,
    )
    assert hint == "break"
