"""build_chapter_outline_context — chapter-level context assembler."""
import json
from pathlib import Path

import pytest


@pytest.fixture
def _projects_dir(tmp_path, monkeypatch):
    from backend.config import settings

    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    yield tmp_path


def _seed_outline(proj_dir: Path, chapters: list[dict]) -> None:
    proj_dir.mkdir(parents=True, exist_ok=True)
    (proj_dir / "novel_outline.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "volumes": [
                    {
                        "name": "第一卷 初入异世",
                        "start_chapter": 1,
                        "end_chapter": 10,
                        "summary": "主角穿越到异世界",
                    }
                ],
                "chapters": chapters,
                "core_conflict_theme": "凡人修仙",
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )


def test_build_chapter_outline_context_renders_volume_and_recent(_projects_dir):
    """正常路径:volume context + recent chapters + 当前 chapter 标题。"""
    proj_dir = _projects_dir / "proj_outline"
    _seed_outline(
        proj_dir,
        [
            {"chapter_number": 1, "title": "雷劫洞中醒", "theme": "重生"},
            {"chapter_number": 2, "title": "初入坊市", "theme": "探索"},
            {"chapter_number": 3, "title": "黑水镇夜谈", "theme": "人际"},
        ],
    )

    from backend.outline_context.builder import build_chapter_outline_context

    ctx = build_chapter_outline_context("proj_outline", 3)
    assert "第一卷" in ctx
    assert "凡人修仙" in ctx  # core_conflict_theme
    assert "黑水镇夜谈" in ctx  # current chapter title
    assert "本卷前文" in ctx  # recent chapters header


def test_build_chapter_outline_context_appends_map_card_when_map_present(_projects_dir):
    """有 map.json 时,output 末尾包含「地图卡」段。"""
    proj_dir = _projects_dir / "proj_outline_with_map"
    _seed_outline(
        proj_dir,
        [
            {"chapter_number": 1, "title": "雷劫洞中醒", "theme": "重生"},
        ],
    )
    (proj_dir / "map.json").write_text(
        json.dumps(
            {
                "schema_version": "1.0",
                "project_id": "proj_outline_with_map",
                "regions": [],
                "locations": [
                    {
                        "id": "loc_qingfeng",
                        "name": "青峰客栈",
                        "type": "inn",
                        "dramatic_role": {"wanted_by": [], "decisions_unlocked": [], "departure_cost": ""},
                    }
                ],
                "routes": [],
                "pois": [],
                "location_states": [],
                "snapshots": [],
                "footprints": [],
                "assertions": [],
                "change_log": [],
                "display": {"positions": {}},
                "settings": {"strict_geo": False, "mode": "allow_alias_new", "chapter_new_location_cap": 5, "reuse_rate_target": 0.6, "scope_enabled": False, "allowed_region_ids": []},
            },
            ensure_ascii=False,
        ),
        encoding="utf-8",
    )

    from backend.outline_context.builder import build_chapter_outline_context

    ctx = build_chapter_outline_context("proj_outline_with_map", 1, scene_location="青峰客栈")
    assert "地图卡" in ctx
    assert "当前: 青峰客栈" in ctx


def test_build_chapter_outline_context_works_without_map_json(_projects_dir):
    """无 map.json 时,不报错,且不输出「地图卡」段。"""
    proj_dir = _projects_dir / "proj_outline_no_map"
    _seed_outline(
        proj_dir,
        [
            {"chapter_number": 1, "title": "雷劫洞中醒", "theme": "重生"},
        ],
    )

    from backend.outline_context.builder import build_chapter_outline_context

    ctx = build_chapter_outline_context("proj_outline_no_map", 1, scene_location="随便")
    assert "地图卡" not in ctx
    # 仍然返回有效 context
    assert "第一卷" in ctx