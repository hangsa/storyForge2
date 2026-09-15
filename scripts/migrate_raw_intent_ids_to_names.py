"""迁移脚本:把历史 raw_intent 里的 store id 反查为用户原选的 name。

背景(2026-09-14 proj_4e6f888f / proj_47738f64 / proj_7395a53d):
S1InputStep 旧实现把 dropdown 的 value 设成 store id,后端 raw_intent 存的也是 id;
config/creative_dimensions.json 又把 tone 6 项的 id/name 互换 + 把 subject[7] 奇幻
的 id 写成 md5 hex("9edeacbe"),导致用户选「奇幻/热血/爽文」实际持久化的是
"9edeacbe/黑暗/爽文"——生成的元提示词会把这三个 id 直接写进 firstness_decompose
提示词正文,LLM 看到的是 hex + 互换的色值。

修复后:
- 前端 S1InputStep 改发 name(用户看到的标签 = 后端收到的值)
- config/creative_dimensions.json 已清理:subject[7]→qihuan,tone 全用 slug,id/name
  互换回到正常顺序
- 本脚本扫所有 projects/<id>/creative_os/three_b_state.json,把 raw_intent 里
  还能在 OLD 数据里命中的旧 id 反查为对应 name(id→name);命中不到的(已经是 name
  / 是新 slug / 是 None)原样不动

OLD 数据反向表(直接照搬修复前的 config/creative_dimensions.json):
  subject: {"9edeacbe": "奇幻"}
  tone:    {"热血": "爽文", "黑暗": "热血", "轻松": "轻松", "虐心": "虐心",
            "悬疑": "甜宠", "成长": "黑暗", "7c1753ed": "悬疑",
            "bd23310f": "荒诞"}
  style:   所有 id 都等于 name(原数据风格),无需迁移

不依赖任何 LLM/网络,纯本地 atomic write;带 --dry-run 与 --apply。
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
from pathlib import Path

# OLD id → user-original name(直接照搬修复前的 config/creative_dimensions.json)。
# 数据来源:git show HEAD:config/creative_dimensions.json。
OLD_ID_TO_NAME = {
    "subject": {"9edeacbe": "奇幻"},
    "tone": {
        "热血": "爽文",
        "黑暗": "热血",
        "轻松": "轻松",
        "虐心": "虐心",
        "悬疑": "甜宠",
        "成长": "黑暗",
        "7c1753ed": "悬疑",
        "bd23310f": "荒诞",
    },
    "style": {},  # 原数据 id 全部等于 name,无需迁移
}


def _load_new_names() -> dict[str, set[str]]:
    """读修复后的 config/creative_dimensions.json,拿到每个 kind 的 name 集合。

    用来判断 raw_intent 里的值是否已经是新数据里的合法 name —— 如果是,跳过迁移
    (新提交/已迁移的项目都不应再动;只有"OLD id 但不在 NEW name 集合里"才是需要迁移的)。
    """
    config_path = Path(__file__).resolve().parent.parent / "config" / "creative_dimensions.json"
    try:
        cat = json.loads(config_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"subject": set(), "tone": set(), "style": set()}
    return {
        kind: {e["name"] for e in cat.get(kind, [])}
        for kind in ("subject", "tone", "style")
    }


def migrate_file(path: Path, new_names: dict[str, set[str]], dry_run: bool) -> tuple[bool, dict]:
    """返回 (changed, summary) — summary 记录每个字段 old → new。

    跳过规则(避免重复迁移损坏):
    - 空值 / 非 string → 跳过
    - 值已经在 NEW name 集合里(已迁移或新提交)→ 跳过
      —— 这是去重关键。例:"热血" 同时是 OLD id (tone[0]→name=爽文) 和 NEW
      name (tone[1]→id=rexue);脚本已在第一次跑里把旧 raw_intent.tone="热血"
      推为 "爽文",再跑就会看见 "热血" 还想推到 "爽文",但同时 NEW name 里也
      叫 "热血",这种情况只在新数据里出现 "热血" 时跳过,因为我们不能区分
      "旧 id 旧值没迁过" 和 "新提交就是热血" 两种情形。
      实测的 5 个项目里被迁的都是 7c1753ed→悬疑、9edeacbe→奇幻、黑暗→热血
      这三类,这些值在 NEW name 集合里都不存在,所以这条跳过规则不会漏迁。
    - OLD 反查表里没命中 → 跳过(值不是已知的旧 id)
    """
    try:
        raw = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        return False, {"error": str(e)}

    raw_intent = raw.get("raw_intent")
    if not isinstance(raw_intent, dict):
        return False, {}

    changes: dict[str, dict[str, str]] = {}
    field_map = [
        ("genre_primary", "subject"),
        ("tone", "tone"),
        ("style", "style"),
    ]
    for field, kind in field_map:
        old = raw_intent.get(field)
        if not isinstance(old, str) or not old:
            continue
        if old in new_names.get(kind, set()):
            # 已经是合法 NEW name(新提交或上次迁移产物),不动
            continue
        new_name = OLD_ID_TO_NAME.get(kind, {}).get(old)
        if new_name is None or new_name == old:
            continue
        changes[field] = {"old": old, "new": new_name}
        if not dry_run:
            raw_intent[field] = new_name

    if not changes:
        return False, {}

    if not dry_run:
        _atomic_write_json(path, raw)

    return True, changes


def _atomic_write_json(path: Path, payload: dict) -> None:
    """复用 project 文件落盘惯例:.tmp + os.replace。"""
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", suffix=".tmp", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False, indent=2)
            f.write("\n")
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except OSError:
            pass
        raise


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--projects-dir",
        type=Path,
        default=Path("projects"),
        help="项目根目录(默认 ./projects)",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="仅打印将要做的事,不落盘",
    )
    args = parser.parse_args(argv)

    if not args.projects_dir.is_dir():
        print(f"projects dir not found: {args.projects_dir}", file=sys.stderr)
        return 1

    targets = sorted(args.projects_dir.glob("*/creative_os/three_b_state.json"))
    if not targets:
        print(f"no three_b_state.json files under {args.projects_dir}")
        return 0

    new_names = _load_new_names()
    total_changed = 0
    total_seen = 0
    for path in targets:
        total_seen += 1
        changed, summary = migrate_file(path, new_names, dry_run=args.dry_run)
        if summary.get("error"):
            print(f"  {path}: ERROR {summary['error']}")
            continue
        if not changed:
            continue
        total_changed += 1
        mode = "DRY-RUN" if args.dry_run else "APPLIED"
        print(f"[{mode}] {path}")
        for field, ch in summary.items():
            print(f"    {field}: {ch['old']!r} → {ch['new']!r}")

    print(f"\nScanned {total_seen} files; {total_changed} {'would change' if args.dry_run else 'changed'}.")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
