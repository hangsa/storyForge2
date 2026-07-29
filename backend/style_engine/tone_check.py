"""Light tone-alignment check between LLM-generated concept and genre template.

After Stage 1 concept generation, the LLM's `concept.tone` (a short phrase
like "克制、烧脑") is compared against the catalog's full `tone` block
(multi-line prose). The check is non-blocking: a low-alignment result
attaches a `warning` to the response so the frontend can surface it, but
the concept is still accepted.

Algorithm: extract 2-character shingles from both sides (Chinese token
"shingles" approximate word boundaries — Chinese doesn't have spaces).
Compute containment = |intersection| / |concept_shingles|. The catalog
is much richer than the LLM's output, so we use containment (what
fraction of the LLM's tone phrases appear in the catalog). Threshold
0.20 means at least 20% of the LLM's tone phrases should match the
genre's expected vocabulary — catches gross misalignment (e.g. LLM
returns "热血" for a 悬疑 concept) without flagging creative variations.
"""
from __future__ import annotations
import re


def _shingles(text: str) -> set[str]:
    """Extract 2-char shingles from Chinese text. Punctuation/whitespace
    dropped; non-C Han chars included.
    """
    cleaned = re.sub(r"[\s　。，！？；：“”‘’《》〈〉\-—_/()/./,!?;:\"]+", "", text)
    return {cleaned[i:i + 2] for i in range(len(cleaned) - 1)}


def _containment(small: set, big: set) -> float:
    """Fraction of `small` covered by `big`. Caller decides which side
    is the smaller (the LLM's tone output is much shorter than the
    catalog's prose block)."""
    if not small:
        return 0.0
    return len(small & big) / len(small)


ALIGNMENT_THRESHOLD = 0.20


def check_tone_alignment(concept_tone: str, genre: str) -> dict:
    """Light tone check: compare LLM concept.tone with catalog tone.

    Returns dict with:
      aligned: bool — True if containment ≥ threshold
      score: float — 0.0 to 1.0
      warning: Optional[str] — human-readable message when misaligned
    """
    try:
        from backend.genres.catalog import get_catalog
        catalog_tone = get_catalog().get(genre).get("tone") or ""
    except Exception:
        return {"aligned": True, "score": 0.0, "warning": None}

    if not concept_tone or not catalog_tone.strip():
        return {"aligned": True, "score": 0.0, "warning": None}

    concept_shingles = _shingles(concept_tone)
    catalog_shingles = _shingles(catalog_tone)
    score = _containment(concept_shingles, catalog_shingles)

    if score >= ALIGNMENT_THRESHOLD:
        return {"aligned": True, "score": score, "warning": None}

    return {
        "aligned": False,
        "score": score,
        "warning": (
            f"生成的题材基调（{concept_tone.strip()}）与该题材的预期基调"
            f"（{catalog_tone.strip()[:40]}...）偏差较大。建议在概念阶段"
            f"重新审视内核设计。"
        ),
    }
