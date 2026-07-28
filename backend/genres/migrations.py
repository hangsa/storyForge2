"""Extract genre config from the legacy three-system layout.

Used by scripts/migrate_genre_catalog.py (one-shot) and tests/
test_migrate_genre_catalog.py. Read-only on the legacy files.
"""
from pathlib import Path
from typing import Any


def load_from_data_style(style_dir: Path) -> dict[str, dict[str, Any]]:
    """Read data/style/*.yaml and return {id: raw_dict}."""
    import yaml
    result: dict[str, dict[str, Any]] = {}
    for f in sorted(style_dir.glob("*.yaml")):
        gid = f.stem
        with open(f, encoding="utf-8") as fh:
            result[gid] = yaml.safe_load(fh) or {}
    return result


def load_from_thresholds(thresholds_path: Path) -> dict[str, dict[str, Any]]:
    """Read config/genre_thresholds.yaml and return {pinyin_id: thresholds_dict}.

    Uses GENRE_NAME_MAPPING from backend.reader_os.thresholds to translate
    Chinese keys -> pinyin ids.
    """
    import yaml
    from backend.reader_os.thresholds import GENRE_NAME_MAPPING
    if not thresholds_path.exists():
        return {}
    raw = yaml.safe_load(thresholds_path.read_text(encoding="utf-8")) or {}
    # genre_thresholds.yaml wraps entries under a `genres:` key.
    entries = raw.get("genres") if isinstance(raw, dict) else None
    if not isinstance(entries, dict):
        return {}
    result: dict[str, dict[str, Any]] = {}
    for zh_key, val in entries.items():
        pinyin = GENRE_NAME_MAPPING.get(zh_key, zh_key)
        result[pinyin] = val
    return result


def load_from_fusion_engine() -> tuple[dict[str, list[str]], dict[str, dict[str, float]]]:
    """Extract _LEGACY_GENRE_GRAPH and _LEGACY_COMPATIBILITY_MATRIX from genre_fusion_engine.py.

    The module exposes them as `_LEGACY_*` (authoritative) and `GENRE_GRAPH` /
    `COMPATIBILITY_MATRIX` (backward-compat aliases that reference the legacy
    names). We read the legacy literal definitions directly from the source
    via regex + ast.literal_eval — that way we never import the module and
    bypass the alias resolution.

    Returns:
        (families, compat) — families is always empty (the script derives
        families from FUSION_ONLY_META hand-curation in
        scripts/migrate_genre_catalog.py). compat maps pinyin_id ->
        {other_pinyin_id: compatibility_score in [0.0, 1.0]}. Keys are
        translated from Chinese via GENRE_NAME_MAPPING; values are
        translated from "高"/"中"/"低" strings to 0.85/0.5/0.15.
    """
    import ast
    import re
    from backend.creative_os import genre_fusion_engine as gfe
    from backend.reader_os.thresholds import GENRE_NAME_MAPPING

    src_path = Path(gfe.__file__)
    src = src_path.read_text(encoding="utf-8")

    # Tolerate either module-level (no indent) or class-level (indented)
    # definitions, since Task 5 moved the matrix inside the class body.
    def _extract(name: str) -> dict:
        # Find the line declaring `name`, then capture from the opening `{`
        # to its matching `}` at the same indent.
        m = re.search(rf"^(\s*){name}\s*:\s*.*?=\s*\{{", src, re.MULTILINE | re.DOTALL)
        if not m:
            return {}
        indent = m.group(1)
        start = m.end() - 1  # position of the `{`
        depth = 0
        end = start
        for i in range(start, len(src)):
            ch = src[i]
            if ch == "{":
                depth += 1
            elif ch == "}":
                depth -= 1
                if depth == 0:
                    end = i + 1
                    break
        literal = src[start:end]
        return ast.literal_eval(literal)

    _graph = _extract("_LEGACY_GENRE_GRAPH")
    raw_compat = _extract("_LEGACY_COMPATIBILITY_MATRIX")

    value_map = {"高": 0.85, "中": 0.5, "低": 0.15}

    # Translate Chinese keys -> pinyin ids. GENRE_NAME_MAPPING only covers the
    # 10 catalog genres; the legacy fusion matrix also has fusion-only Chinese
    # keys (武侠, 末世, ...) so we extend the mapping for those.
    extended_mapping = {
        **GENRE_NAME_MAPPING,
        "修仙": "xiuxian",
        "武侠": "wuxia",
        "神话": "shenhua",
        "奇幻": "qihuan",
        "恐怖": "kongbu",
        "末世": "moshi",
        "历史": "lishi",
        "游戏": "youxi",
        "推理": "tuili",
        "异界": "yijie",
        "战争": "zhanzheng",
    }

    def to_pinyin(zh: str) -> str:
        return extended_mapping.get(zh, zh)

    compat: dict[str, dict[str, float]] = {}
    for a, row in raw_compat.items():
        a_pin = to_pinyin(a)
        compat.setdefault(a_pin, {})
        for b, val in row.items():
            b_pin = to_pinyin(b)
            compat[a_pin][b_pin] = value_map.get(val, 0.5)

    # `graph` here is the legacy dict[str, set[str]] shape; we just return
    # empty families (the script derives families from FUSION_ONLY_META
    # hand-curation).
    families: dict[str, list[str]] = {}
    return families, compat