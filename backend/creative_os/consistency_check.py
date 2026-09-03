"""PRD §17.2: 5-dimension consistency check.

Deterministic checks on the current concept state:
- Concept (premise + core_conflict non-empty)
- World Logic (>=1 world_rule declared)
- Character Potential (>=1 named character with role)
- Conflict Potential (core_conflict mentions opposition keywords)
- Novelty (concept.novelty >= 0.5)

Failure is per-dimension. Caller decides whether to regenerate.

IMPORTANT: This helper reports `novelty` as a failure when below threshold,
but the CALLER must filter out the `novelty` dimension before triggering
regeneration. Rationale: `current_concept.novelty` is initialized to 0.0 in
`_empty_canvas_v4()` and the LLM doesn't always set it. If the caller
treated `novelty` like any other failure, every step would trigger spurious
regeneration because `novelty < 0.5`.
"""
from dataclasses import dataclass, field

CONFLFLICT_KEYWORDS = {"冲突", "矛盾", "对立", "对抗", "紧张", "挣扎", "两难", "vs"}
NOVELTY_THRESHOLD = 0.5


@dataclass
class Failure:
    dimension: str
    reason: str
    suggestion: str


@dataclass
class CheckResult:
    passed: bool
    failures: list[Failure] = field(default_factory=list)


def check_consistency(concept: dict) -> CheckResult:
    failures: list[Failure] = []

    if not (concept.get("premise") or "").strip():
        failures.append(Failure("concept", "premise is empty",
                                "Regenerate with a premise that establishes the core setup."))
    if not (concept.get("core_conflict") or "").strip():
        failures.append(Failure("concept", "core_conflict is empty",
                                "Regenerate with explicit conflict statement."))

    if not concept.get("world_rules"):
        failures.append(Failure("world", "no world_rules declared",
                                "Add at least one world rule to anchor the setting."))

    characters = concept.get("characters", [])
    if not characters or not any(c.get("role") for c in characters):
        failures.append(Failure("character", "no named characters with roles",
                                "Regenerate with at least one protagonist."))

    core_conflict = concept.get("core_conflict", "")
    if core_conflict and not any(kw in core_conflict for kw in CONFLFLICT_KEYWORDS):
        failures.append(Failure(
            "conflict",
            f"core_conflict lacks conflict keywords ({sorted(CONFLFLICT_KEYWORDS)})",
            "Reframe conflict in terms of opposition/tension.",
        ))

    novelty = concept.get("novelty", 0.0)
    if novelty < NOVELTY_THRESHOLD:
        failures.append(Failure("novelty",
                                f"novelty {novelty:.2f} below {NOVELTY_THRESHOLD}",
                                "Regenerate with a more distinctive angle."))

    return CheckResult(passed=len(failures) == 0, failures=failures)