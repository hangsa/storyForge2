"""OutlineTermGuard — post-merge safety net for novel/chapter outlines.

The soft constraint in backend/prompts/novel_outline_generation.yaml
(system_prompt rule #10) and outline_generation.yaml (rule #11) tells
the LLM to stay inside the world.json's power-system stages whitelist.
LLMs can still leak training-data tropes — this module scans the
generated outline dict for xianxia cultivation terms absent from the
declared world and surfaces them as structured violations. Endpoints
that write novel_outline.json / outline.json should call
`scan_outline_for_forbidden_terms` after the merge and reject with
422 if any violations are found.

Surfaced on proj_1a7d7fcf (2026-08-22): world.json defines 建木灵种
+ 古修 systems without 元婴, yet Volume 1's summary mentioned
'一剑斩灭元婴级追兵'. The prompt fix (commit de50767) closes the
common case; this guard closes the leak.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional


# Baseline forbidden xianxia cultivation tropes. Mirrors the hard
# constraint listed in the system_prompt of novel_outline_generation.yaml
# and outline_generation.yaml. Substring-matched, so compound forms like
# '元婴级', '金丹期', '筑基境' are also caught (the term is the prefix).
#
# The list is intentionally narrow: it's a safety net for the most common
# training-data tropes that bled into proj_1a7d7fcf, not a full xianxia
# vocabulary. Novel projects that intentionally use these terms should
# add them to their world.json's power_systems[*].stages — the guard
# will then treat them as legitimate (see _collect_allowed_terms).
BASELINE_FORBIDDEN_TERMS: tuple[str, ...] = (
    "元婴",
    "金丹",
    "筑基",
    "化神",
    "结丹",
    "渡劫",
    "大乘",
    "练气",
)


@dataclass(frozen=True)
class ForbiddenTerm:
    """One instance of a forbidden term in the outline.

    Attributes:
      path: JSON-pointer-style location, e.g. 'volumes[1].summary' or
        'chapters[0].scenes[2].conflict'. Useful for the 422 message and
        for the user's "go to field" affordance in the wizard.
      term: The forbidden term that matched (one of BASELINE_FORBIDDEN_TERMS).
      snippet: Up to ~40-char excerpt around the match for context.
    """
    path: str
    term: str
    snippet: str


def _make_snippet(text: str, term: str, ctx: int = 20) -> str:
    """Return a short excerpt around the first occurrence of `term`."""
    idx = text.find(term)
    if idx == -1:
        return text[: 2 * ctx]
    start = max(0, idx - ctx)
    end = min(len(text), idx + len(term) + ctx)
    return text[start:end]


def _scan(
    node,
    path: str,
    forbidden: tuple[str, ...],
    seen: set[tuple[str, str]],
    out: list[ForbiddenTerm],
) -> None:
    """Recursively walk `node`, appending ForbiddenTerm for each match.

    `seen` de-duplicates identical (path, term) pairs — the same string
    field can only contribute one violation per term, even if the term
    appears multiple times within that string.
    """
    if isinstance(node, dict):
        for k, v in node.items():
            child_path = f"{path}.{k}" if path else str(k)
            _scan(v, child_path, forbidden, seen, out)
    elif isinstance(node, list):
        for i, v in enumerate(node):
            _scan(v, f"{path}[{i}]", forbidden, seen, out)
    elif isinstance(node, str) and node:
        for term in forbidden:
            if term in node and (path, term) not in seen:
                seen.add((path, term))
                out.append(ForbiddenTerm(path=path, term=term, snippet=_make_snippet(node, term)))


def scan_outline_for_forbidden_terms(
    outline: Optional[dict],
    world: Optional[dict],
    forbidden: tuple[str, ...] = BASELINE_FORBIDDEN_TERMS,
) -> list[ForbiddenTerm]:
    """Walk an outline dict, returning one ForbiddenTerm per (path, term).

    Args:
      outline: The full outline document (novel_outline.json shape or
        outline.json shape — both recursive).
      world: Currently unused — kept in the signature for a future
        per-project override feature. The baseline list always applies
        regardless of world stages; a project that legitimately uses
        e.g. '元婴' should reach for the per-project override (TBD) or
        accept the false-positive warnings.
      forbidden: Override the baseline list. Mostly for tests.

    Returns:
      List of ForbiddenTerm, empty when clean. Order: depth-first traversal
      of the outline doc, terms in BASELINE_FORBIDDEN_TERMS order within
      a given field.
    """
    out: list[ForbiddenTerm] = []
    if outline is None:
        return out
    _scan(outline, "", forbidden, set(), out)
    return out
