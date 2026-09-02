"""Verify Step state machine: 5 states + transition_step + _validate_step_invariants."""
import pytest
from backend.creative_os.state_machine import (
    transition_step_state,
    _validate_step_invariants,
    StepStateError,
)


def _make_canvas(num_steps: int, states: list) -> dict:
    """Helper: build a v4 canvas with N steps and given states."""
    return {
        "schema_version": 4,
        "creative_path": [
            {
                "step": i + 1,
                "operation": None,
                "operation_reason": None,
                "options": [],
                "selected_option_id": opt_id if states[i] == "completed" else None,
                "created_at": "2026-09-02T10:00:00",
                "selected_at": "2026-09-02T10:00:00" if states[i] == "completed" else None,
                "regenerated_count": 0,
                "state": states[i],
            }
            for i, opt_id in zip(range(num_steps), ["option_1_a"] * num_steps)
        ],
    }


def test_init_makes_step_1_available_and_rest_locked():
    canvas = _make_canvas(5, ["locked"] * 5)
    transition_step_state(canvas, event="init")
    assert canvas["creative_path"][0]["state"] == "available"
    for i in range(1, 5):
        assert canvas["creative_path"][i]["state"] == "locked"


def test_activate_step_makes_state_active():
    canvas = _make_canvas(5, ["available", "locked", "locked", "locked", "locked"])
    transition_step_state(canvas, step=1, event="activate")
    assert canvas["creative_path"][0]["state"] == "active"


def test_complete_step_makes_completed_and_unlocks_next():
    canvas = _make_canvas(5, ["active", "locked", "locked", "locked", "locked"])
    canvas["creative_path"][0]["selected_option_id"] = "option_1_b"
    transition_step_state(canvas, step=1, event="complete")
    assert canvas["creative_path"][0]["state"] == "completed"
    assert canvas["creative_path"][1]["state"] == "available"
    # Steps 3-5 remain locked
    for i in range(2, 5):
        assert canvas["creative_path"][i]["state"] == "locked"


def test_complete_step_5_does_not_try_to_unlock_step_6():
    canvas = _make_canvas(5, ["completed", "completed", "completed",
                              "completed", "active"])
    canvas["creative_path"][4]["selected_option_id"] = "option_5_c"
    transition_step_state(canvas, step=5, event="complete")
    assert canvas["creative_path"][4]["state"] == "completed"
    # No IndexError — only 5 steps exist


def test_backtrack_from_marks_downstream_stale():
    """v2.1 behavior; v2.0 doesn't trigger it but the function must support it."""
    canvas = _make_canvas(5, ["completed", "completed", "active", "locked", "locked"])
    transition_step_state(canvas, step=3, event="backtrack_from")
    assert canvas["creative_path"][0]["state"] == "completed"
    assert canvas["creative_path"][1]["state"] == "completed"
    assert canvas["creative_path"][2]["state"] == "stale"
    assert canvas["creative_path"][3]["state"] == "stale"
    assert canvas["creative_path"][4]["state"] == "stale"


# --- invariants ---


def test_validate_invariants_passes_for_valid_5_step_completed():
    canvas = _make_canvas(5, ["completed"] * 5)
    _validate_step_invariants(canvas)  # should not raise


def test_validate_invariants_rejects_too_many_steps():
    canvas = _make_canvas(6, ["completed"] * 6)
    with pytest.raises(StepStateError, match="超过 5"):
        _validate_step_invariants(canvas)


def test_validate_invariants_rejects_missing_step_1():
    canvas = {"creative_path": [
        {"step": 2, "state": "completed", "selected_option_id": "x"},
    ]}
    with pytest.raises(StepStateError, match="Step 1"):
        _validate_step_invariants(canvas)


def test_validate_invariants_rejects_stale_steps():
    canvas = _make_canvas(5, ["completed", "completed", "stale", "locked", "locked"])
    with pytest.raises(StepStateError, match="STALE"):
        _validate_step_invariants(canvas)


def test_validate_invariants_rejects_completed_without_selection():
    canvas = _make_canvas(5, ["completed", "completed", "completed",
                              "completed", "completed"])
    canvas["creative_path"][2]["selected_option_id"] = None
    with pytest.raises(StepStateError, match="selected_option_id"):
        _validate_step_invariants(canvas)
