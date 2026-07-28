#!/usr/bin/env python3
"""One-shot script: extract genre config from legacy three-system layout, write new catalog.

Usage:
    python scripts/migrate_genre_catalog.py --dry-run     # preview only
    python scripts/migrate_genre_catalog.py --apply       # write files
    python scripts/migrate_genre_catalog.py --target DIR  # custom output dir (default config/genres)
    python scripts/migrate_genre_catalog.py --force       # overwrite existing files

Idempotent: re-running with --apply does not overwrite existing files unless --force is set.
"""
import argparse
import sys
from pathlib import Path

import yaml

# Make backend importable when run from project root
sys.path.insert(0, str(Path(__file__).parent.parent))

from backend.genres.migrations import (
    load_from_data_style,
    load_from_thresholds,
    load_from_fusion_engine,
)


REPO_ROOT = Path(__file__).parent.parent

# Live genre-catalog location (hand-authored; --apply --force here clobbers it).
LIVE_CATALOG = REPO_ROOT / "config" / "genres"

# Hand-curated labels + families for the 7 base genres that DO have a
# data/style/*.yaml entry but lack label_zh/label_en/family fields. data/style YAML
# only carries pacing/tone/style_rules/writing_formula data; metadata is here.
BASE_GENRE_META: dict[str, dict[str, str]] = {
    "cool_novel": {"label_zh": "爽文", "label_en": "Power Fantasy", "family": "power_fantasy"},
    "xianxia":    {"label_zh": "仙侠", "label_en": "Xianxia",        "family": "cultivation"},
    "xuanhuan":   {"label_zh": "玄幻", "label_en": "Xuanhuan",       "family": "cultivation"},
    "dushi":      {"label_zh": "都市", "label_en": "Contemporary",   "family": "contemporary"},
    "kehuan":     {"label_zh": "科幻", "label_en": "Sci-Fi",         "family": "sci_fi"},
    "xuanyi":     {"label_zh": "悬疑", "label_en": "Mystery",        "family": "mystery"},
    "yanqing":    {"label_zh": "言情", "label_en": "Romance",        "family": "romance"},
}

# Hand-curated labels + families for the 11 fusion-only genres that have no
# data/style/*.yaml entry. These are surfaced in the catalog as `ui_visible: false`
# until full pacing/tone/writing_formula/thresholds are authored.
FUSION_ONLY_META: dict[str, dict[str, str]] = {
    "wuxia":     {"label_zh": "武侠", "label_en": "Wuxia",            "family": "cultivation"},
    "kongbu":    {"label_zh": "恐怖", "label_en": "Horror",           "family": "mystery"},
    "moshi":     {"label_zh": "末世", "label_en": "Post-Apocalyptic", "family": "sci_fi"},
    "lishi":     {"label_zh": "历史", "label_en": "Historical",       "family": "contemporary"},
    "shenhua":   {"label_zh": "神话", "label_en": "Mythology",        "family": "cultivation"},
    "youxi":     {"label_zh": "游戏", "label_en": "Game Lit",         "family": "sci_fi"},
    "tuili":     {"label_zh": "推理", "label_en": "Detective",        "family": "mystery"},
    "yijie":     {"label_zh": "异界", "label_en": "Isekai",           "family": "cultivation"},
    "zhanzheng": {"label_zh": "战争", "label_en": "War",              "family": "contemporary"},
    "qihuan":    {"label_zh": "奇幻", "label_en": "Western Fantasy",  "family": "cultivation"},
    "xiuxian":   {"label_zh": "修仙", "label_en": "Cultivation",      "family": "cultivation"},  # 修仙 (separate from xianxia 仙侠 in legacy graph)
}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--target", default=str(REPO_ROOT / "config" / "genres"))
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--force", action="store_true")
    args = parser.parse_args()
    if not (args.dry_run or args.apply):
        parser.error("Specify --dry-run or --apply")

    target = Path(args.target)

    # Safety: --apply --force on the live hand-authored catalog would clobber
    # human-curated entries with regenerated output. Require explicit confirmation.
    if args.apply and args.force and target.resolve() == LIVE_CATALOG.resolve():
        print(
            f"WARNING: --force on live catalog ({LIVE_CATALOG}). Use only if you intend to "
            "regenerate from legacy sources. Existing hand-authored data will be overwritten.",
            file=sys.stderr,
        )
        response = input("Continue? [y/N] ").strip().lower()
        if response != "y":
            print("Aborted.")
            return 1

    style_data = load_from_data_style(REPO_ROOT / "data" / "style")
    thresholds = load_from_thresholds(REPO_ROOT / "config" / "genre_thresholds.yaml")
    _families, compat = load_from_fusion_engine()

    # Merge per-genre
    merged: dict[str, dict] = {}
    all_ids = sorted(set(list(style_data.keys()) + list(compat.keys())))
    for gid, raw in style_data.items():
        meta = BASE_GENRE_META.get(gid, {})
        merged[gid] = {
            **raw,
            "id": gid,
            "label_zh": raw.get("label_zh") or meta.get("label_zh") or raw.get("name", gid),
            "label_en": raw.get("label_en") or meta.get("label_en", gid),
            "family":   raw.get("family")   or meta.get("family", "default"),
            "thresholds": thresholds.get(gid, {}),
            "fusion_meta": {"distances": {
                other: round(1.0 - compat.get(gid, {}).get(other, 0.5), 2)
                for other in all_ids if other != gid
            }},
        }

    # 11 fusion-only genres that have no data/style entry
    fusion_only = set(compat.keys()) - set(merged.keys())
    for gid in fusion_only:
        meta = FUSION_ONLY_META.get(gid, {"label_zh": gid, "label_en": gid, "family": "default"})
        merged[gid] = {
            "id": gid,
            "label_zh": meta["label_zh"],
            "label_en": meta["label_en"],
            "family": meta["family"],
            "pacing": {},
            "tone": "",
            "style_rules": [],
            "writing_formula": {},
            "taboo_words": [],
            "taboos": [],
            "trope_patterns": [],
            "thresholds": {},
            "model_preferences": {},
            "fusion_meta": {"distances": {
                other: round(1.0 - compat.get(gid, {}).get(other, 0.5), 2)
                for other in all_ids if other != gid
            }},
            "_stub": True,
        }

    print(f"Would write {len(merged)} per-genre files to {target}")
    print(f"  Per-genre from data/style: {sorted(style_data.keys())}")
    print(f"  Stub-only (need authoring): {sorted(fusion_only)}")

    if args.dry_run:
        return 0

    target.mkdir(parents=True, exist_ok=True)
    for gid, data in merged.items():
        path = target / f"{gid}.yaml"
        if path.exists() and not args.force:
            print(f"  skip (exists): {path}")
            continue
        path.write_text(yaml.safe_dump(data, allow_unicode=True, sort_keys=False), encoding="utf-8")
        print(f"  wrote: {path}")

    # Write index.yaml
    index_path = target / "index.yaml"
    if not index_path.exists() or args.force:
        index_path.write_text(yaml.safe_dump({
            "genres": [
                {"id": gid, "label_zh": d.get("label_zh", gid), "label_en": d.get("label_en", gid),
                 "family": d.get("family", "default"),
                 **({"ui_visible": False} if d.get("_stub") else {})}
                for gid, d in sorted(merged.items(), key=lambda x: (
                    x[1].get("_stub", False),  # non-stub first
                    x[0]
                ))
            ]
        }, allow_unicode=True, sort_keys=False), encoding="utf-8")
        print(f"  wrote: {index_path}")

    # Write compatibility.yaml (symmetric matrix from compat dict).
    compat_path = target / "compatibility.yaml"
    if not compat_path.exists() or args.force:
        # Build symmetric matrix: pair (a, b) and (b, a) using the same value.
        ids = sorted(merged.keys())
        matrix: dict[str, dict[str, float]] = {gid: {} for gid in ids}
        for a in compat.keys():
            for b, val in compat[a].items():
                if a in matrix and b in matrix:
                    matrix[a][b] = val
                    matrix[b][a] = val
        # Self-pairs and missing pairs default to 0.5
        for a in matrix:
            for b in matrix:
                if a == b:
                    matrix[a][b] = 0.0
                elif b not in matrix[a]:
                    matrix[a][b] = 0.5
        # For matrix ids that are NOT in merged (e.g. cool_novel), add a
        # row so the matrix is symmetric across all merged ids.
        for a in ids:
            for b in ids:
                matrix[a].setdefault(b, 0.5 if a != b else 0.0)
        compat_path.write_text(yaml.safe_dump(
            {"matrix": matrix}, allow_unicode=True, sort_keys=False
        ), encoding="utf-8")
        print(f"  wrote: {compat_path}")

    # Write families.yaml (group genres by their family field).
    families_path = target / "families.yaml"
    if not families_path.exists() or args.force:
        families_map: dict[str, list[str]] = {}
        for gid, data in merged.items():
            fam = data.get("family", "default")
            families_map.setdefault(fam, []).append(gid)
        # Sort each family list
        for fam in families_map:
            families_map[fam] = sorted(families_map[fam])
        families_path.write_text(yaml.safe_dump(
            {"families": families_map}, allow_unicode=True, sort_keys=False
        ), encoding="utf-8")
        print(f"  wrote: {families_path}")

    print("\nDone. Next steps:")
    print("  1. Hand-author pacing/tone/writing_formula/thresholds for stub genres")
    print("  2. Add # DEPRECATED banners to old files (Task 14)")
    print("  3. Run pytest to confirm catalog loads cleanly")
    return 0


if __name__ == "__main__":
    sys.exit(main())