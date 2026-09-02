"""compute_op_hint — deterministic backend op-selection (spec §6.2).

The LLM can micro-adjust the hint, but the final `operation` must be
self-consistent with `operation_reason`. This function provides a
stable fallback when LLM is unavailable or returns low-confidence output.

Returns one of: "twist" | "break" | "fuse" | "invert" | "escalate" | "dramaturgy"

Note: rule 3 detects only literal "无冲突"/"无矛盾" negation. Natural-language
phrasings like "没有冲突"/"缺乏矛盾" slip past and rely on substring match
happening to give the right answer. v2.1 should enumerate prefix tokens.
"""
from __future__ import annotations

from typing import Iterable, Literal


NOVELTY_TWIST_THRESHOLD = 0.5
_OpHint = Literal["twist", "break", "fuse", "invert", "escalate", "dramaturgy"]


def compute_op_hint(
    concept: dict,
    path: Iterable[dict],
    step: int,
    genres: list[str] | None = None,
) -> _OpHint:
    """Pure function. Same inputs → same output (no LLM)."""
    genres = genres or []

    # 1. Step 5 is always the "收束" / dramaturgy step
    if step >= 5:
        return "dramaturgy"

    # 2. Low novelty → twist to find fresh angle.
    # 0.0 collapses to 0 via `or` — semantic intent: "novelty missing or
    # explicitly zero → twist" (load-bearing; do not change to .get(..., 0)).
    if (concept.get("novelty") or 0) < NOVELTY_TWIST_THRESHOLD:
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

    # 5. Escalate: cheaper refinement over an existing personal conflict.
    # Runs before invert because invert resets the conflict; escalate is
    # more specific and less destructive.
    if concept.get("conflict_scale") in ("personal", None):
        return "escalate"

    # 6. Step ≥ 3 with no invert in history → invert for reversal
    if step >= 3 and not any(p.get("operation") == "invert" for p in path):
        return "invert"

    # 7. Default
    return "twist"
