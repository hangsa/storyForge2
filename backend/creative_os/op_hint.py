"""compute_op_hint — deterministic backend op-selection (spec §6.2).

The LLM can micro-adjust the hint, but the final `operation` must be
self-consistent with `operation_reason`. This function provides a
stable fallback when LLM is unavailable or returns low-confidence output.

Returns one of: "twist" | "break" | "fuse" | "invert" | "escalate" | "dramaturgy"
"""
from __future__ import annotations

from typing import Iterable


_VALID_OPS = {"twist", "break", "fuse", "invert", "escalate", "dramaturgy"}


def compute_op_hint(
    concept: dict,
    path: Iterable[dict],
    step: int,
    genres: list[str] | None = None,
) -> str:
    """Pure function. Same inputs → same output (no LLM)."""
    genres = genres or []

    # 1. Step 5 is always the "收束" / dramaturgy step
    if step >= 5:
        return "dramaturgy"

    # 2. Low novelty → twist to find fresh angle
    if (concept.get("novelty") or 0) < 0.5:
        return "twist"

    # 3. Missing core conflict → break to introduce one.
    # Detect Chinese negation patterns first ("无冲突"/"无矛盾") because naive
    # substring matching of "冲突" against "无冲突" yields the opposite answer.
    core = concept.get("core_conflict") or ""
    if "无冲突" in core or "无矛盾" in core:
        return "break"
    if "冲突" not in core and "矛盾" not in core:
        return "break"

    # 4. Single-genre canvas → fuse to introduce cross-genre
    if len(genres) < 2:
        return "fuse"

    # 5. Conflict exists but at personal/None scale → escalate
    # Runs before invert because escalate refines the existing conflict,
    # whereas invert resets it — escalate is the cheaper, more specific fix.
    if concept.get("conflict_scale") in ("personal", None):
        return "escalate"

    # 6. Step ≥ 3 with no invert in history → invert for reversal
    if step >= 3 and not any(p.get("operation") == "invert" for p in path):
        return "invert"

    # 7. Default
    return "twist"
