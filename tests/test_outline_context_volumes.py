"""Tests for backend/outline_context/volumes.py — chapter-to-volume mapping."""
import pytest

from backend.outline_context.volumes import (
    ParsedVolume,
    locate_volume,
    parse_volumes,
    planned_total,
)


def _vol(name, rng, summary="", key_events=None):
    return {
        "name": name,
        "chapter_range": rng,
        "summary": summary,
        "key_events": key_events if key_events is not None else [],
    }


class TestParseVolumes:
    def test_parses_well_formed_volumes(self):
        outline = {"volumes": [
            _vol("第一卷", "1-50", "觉醒", ["金手指开启"]),
            _vol("第二卷", "51-120", "宗门之争", ["擂台赛"]),
        ]}
        result = parse_volumes(outline)
        assert len(result) == 2
        assert result[0].name == "第一卷"
        assert (result[0].start, result[0].end) == (1, 50)
        assert result[0].summary == "觉醒"
        assert result[0].key_events == ["金手指开启"]
        assert (result[1].start, result[1].end) == (51, 120)

    def test_index_reflects_sorted_order(self):
        """User hand-edits can leave volumes out of order; index is post-sort."""
        outline = {"volumes": [_vol("第二卷", "51-120"), _vol("第一卷", "1-50")]}
        result = parse_volumes(outline)
        assert [v.name for v in result] == ["第一卷", "第二卷"]
        assert [v.index for v in result] == [0, 1]

    def test_tolerates_whitespace_in_range(self):
        result = parse_volumes({"volumes": [_vol("第一卷", " 1 - 50 ")]})
        assert (result[0].start, result[0].end) == (1, 50)

    @pytest.mark.parametrize("bad_range", ["0-5", "50-1", "abc", "1~5", "", "5", "1-2-3"])
    def test_drops_malformed_ranges(self, bad_range):
        assert parse_volumes({"volumes": [_vol("坏卷", bad_range)]}) == []

    def test_drops_non_dict_volume_entries(self):
        outline = {"volumes": ["不是字典", None, _vol("第一卷", "1-50")]}
        result = parse_volumes(outline)
        assert len(result) == 1
        assert result[0].name == "第一卷"

    def test_drops_non_string_range(self):
        assert parse_volumes({"volumes": [{"name": "x", "chapter_range": 5}]}) == []

    @pytest.mark.parametrize("outline", [None, {}, {"volumes": None}, {"volumes": "x"}, "字符串"])
    def test_degenerate_input_returns_empty(self, outline):
        assert parse_volumes(outline) == []

    def test_non_string_key_events_dropped(self):
        result = parse_volumes({"volumes": [_vol("第一卷", "1-50", key_events=["ok", 42, None])]})
        assert result[0].key_events == ["ok"]


class TestPlannedTotal:
    def test_returns_max_end(self):
        outline = {"volumes": [_vol("一", "1-50"), _vol("二", "51-120")]}
        assert planned_total(outline) == 120

    def test_ignores_malformed_volumes(self):
        outline = {"volumes": [_vol("一", "1-50"), _vol("坏", "999-1")]}
        assert planned_total(outline) == 50

    @pytest.mark.parametrize("outline", [None, {}, {"volumes": []}])
    def test_zero_when_unavailable(self, outline):
        assert planned_total(outline) == 0


class TestLocateVolume:
    @pytest.fixture
    def volumes(self):
        return parse_volumes({"volumes": [
            _vol("第一卷", "1-50"), _vol("第二卷", "51-120"),
        ]})

    def test_inside_volume(self, volumes):
        assert locate_volume(75, volumes).name == "第二卷"

    def test_at_start_boundary(self, volumes):
        assert locate_volume(51, volumes).name == "第二卷"

    def test_at_end_boundary(self, volumes):
        assert locate_volume(50, volumes).name == "第一卷"

    def test_beyond_last_volume_falls_back_to_last(self, volumes):
        """Over-written chapters are narratively a continuation of the last volume."""
        assert locate_volume(500, volumes).name == "第二卷"

    def test_below_first_volume_falls_back_to_first(self):
        volumes = parse_volumes({"volumes": [_vol("第一卷", "10-50")]})
        assert locate_volume(3, volumes).name == "第一卷"

    def test_gap_between_volumes_falls_back_to_earlier(self):
        volumes = parse_volumes({"volumes": [_vol("一", "1-10"), _vol("二", "21-30")]})
        assert locate_volume(15, volumes).name == "一"

    def test_empty_volumes_returns_none(self):
        assert locate_volume(1, []) is None