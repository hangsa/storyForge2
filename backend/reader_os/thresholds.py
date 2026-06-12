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

INTENSITY_SCORES = {
    "low": 20,
    "medium": 40,
    "high": 70,
    "critical": 95,
}
