from pathlib import Path
import logging

import yaml

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

# Hardcoded fallback when YAML is missing or invalid
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


def _map_threshold_keys(genres: dict) -> dict[str, dict]:
    """Emit both Chinese and pinyin keys, plus normalize to internal key names."""
    result = {}
    for name, thresholds in genres.items():
        normalized = dict(thresholds)
        # Remap YAML user-facing labels → internal severity-based keys
        # for calculator.py backward compatibility.
        # YAML "addiction_critical" (50) → internal "addiction_severe"
        # YAML "addiction_moderate" (35) → internal "addiction_critical"
        yac = normalized.pop("addiction_critical", None)
        yam = normalized.pop("addiction_moderate", None)
        if yac is not None:
            normalized["addiction_severe"] = yac
            normalized["addiction_critical"] = yac  # keep YAML key name as alias
        if yam is not None:
            normalized["addiction_critical"] = yam
            normalized["addiction_moderate"] = yam
        if "fatigue_formula" not in normalized:
            normalized["fatigue_formula"] = {
                "threshold": normalized.get("fatigue_moderate", 50),
                "decay": 1.0,
            }

        pinyin = GENRE_NAME_MAPPING.get(name)
        result[name] = normalized
        if pinyin:
            result[pinyin] = normalized
    return result


def load_genre_thresholds() -> dict[str, dict]:
    """Load genre thresholds from config/genre_thresholds.yaml.

    Falls back to hardcoded GENRE_THRESHOLDS if file is missing or invalid.
    Keys are emitted in both Chinese and pinyin forms via GENRE_NAME_MAPPING.
    """
    config_path = Path("config/genre_thresholds.yaml")
    try:
        if config_path.exists():
            with open(config_path, "r", encoding="utf-8") as f:
                data = yaml.safe_load(f)
            genres = data.get("genres", {}) if data else {}
            if genres:
                return _map_threshold_keys(genres)
    except Exception:
        logger.warning("Failed to load genre_thresholds.yaml, using defaults")

    return dict(GENRE_THRESHOLDS)


INTENSITY_SCORES = {
    "low": 20,
    "medium": 40,
    "high": 70,
    "critical": 95,
}
