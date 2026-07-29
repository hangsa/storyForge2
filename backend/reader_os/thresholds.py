from __future__ import annotations
import logging

logger = logging.getLogger(__name__)

GENRE_NAME_MAPPING = {
    # Chinese → pinyin (genre templates use pinyin as internal keys)
    "爽文": "cool_novel",
    "严肃文学": "serious_literature",
    "悬疑推理": "xuanyi",
    "悬疑": "xuanyi",
    "科幻": "kehuan",
    "奇幻": "qihuan",
    "玄幻": "xuanhuan",
    "都市": "dushi",
    "言情": "yanqing",
    "仙侠": "xianxia",
}

# Hardcoded fallback when catalog is missing
# Uses internal severity-based key names (lower threshold = more severe warning)
GENRE_THRESHOLDS = {
    "cool_novel": {
        "addiction_severe": 50,
        "addiction_critical": 35,
        "fatigue_moderate": 55,
        "fatigue_formula": {"threshold": 60, "decay": 1.0},
    },
    "generic": {
        "addiction_severe": 40,
        "addiction_critical": 30,
        "fatigue_moderate": 50,
        "fatigue_formula": {"threshold": 50, "decay": 1.5},
    },
}


def _normalize_thresholds(thresholds: dict) -> dict:
    """Remap YAML user-facing labels → internal severity-based keys.

    YAML "addiction_critical" (higher value) → internal "addiction_severe"
    YAML "addiction_moderate"  (lower value) → internal "addiction_critical"

    Keeps original YAML keys as aliases for frontend display.
    """
    normalized = dict(thresholds)

    yac = normalized.pop("addiction_critical", None)   # YAML: higher threshold
    yam = normalized.pop("addiction_moderate", None)   # YAML: lower threshold

    if yac is not None and yam is not None:
        # Both keys present: clean remap
        normalized["addiction_severe"] = yac
        normalized["addiction_critical"] = yam
        normalized["addiction_moderate"] = yam   # keep YAML alias
    elif yac is not None:
        # Only higher threshold provided: derive lower with 15-point offset
        normalized["addiction_severe"] = yac
        normalized["addiction_critical"] = yac - 15
        normalized["addiction_moderate"] = yac   # keep YAML alias
        logger.warning(
            "addiction_critical present without addiction_moderate; "
            "derived addiction_critical=%d from %d", yac - 15, yac
        )
    elif yam is not None:
        # Only lower threshold provided
        normalized["addiction_critical"] = yam
        normalized["addiction_moderate"] = yam

    # Prefer explicit YAML fatigue_formula; synthesize as fallback
    if "fatigue_formula" not in normalized:
        normalized["fatigue_formula"] = {
            "threshold": normalized.get("fatigue_moderate", 50),
            "decay": 1.0,
        }

    return normalized


def load_genre_thresholds() -> dict[str, dict]:
    """Load genre thresholds from GenreCatalog.

    Return shape includes both pinyin ids and Chinese labels so existing
    project.json genre values (which may use either form) keep resolving.
    """
    from backend.genres.catalog import get_catalog

    catalog = get_catalog()
    entries = catalog.list()
    if not entries:
        raise ValueError("GenreCatalog returned an empty genre list")

    result: dict[str, dict] = {}
    for entry in entries:
        genre_id = entry["id"]
        normalized = _normalize_thresholds(catalog.get_thresholds(genre_id))
        result[genre_id] = normalized
        label_zh = entry.get("label_zh")
        if label_zh:
            result[label_zh] = normalized

    # Preserve legacy Chinese aliases (e.g. 悬疑推理 → xuanyi) so existing
    # project.json genre values keep resolving.
    for alias, genre_id in GENRE_NAME_MAPPING.items():
        if alias not in result and genre_id in result:
            result[alias] = result[genre_id]

    if "generic" not in result:
        result["generic"] = dict(GENRE_THRESHOLDS["generic"])
    return result


INTENSITY_SCORES = {
    "low": 20,
    "medium": 40,
    "high": 70,
    "critical": 95,
}
