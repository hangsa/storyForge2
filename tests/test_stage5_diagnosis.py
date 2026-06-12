"""
STAGE 5 diagnosis engine unit tests.
Tests: timeline detection, narrative asset legacy, foreshadowing integrity.
"""
import json
import tempfile
from pathlib import Path

import pytest

from backend.api.stage5_diagnosis import DiagnosisEngine


@pytest.fixture
def projects_dir():
    with tempfile.TemporaryDirectory() as tmp:
        yield Path(tmp)


def _write_json(base: Path, project_id: str, rel_path: str, data):
    path = base / project_id / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False)


def _write_md(base: Path, project_id: str, rel_path: str, text: str):
    path = base / project_id / rel_path
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        f.write(text)


def _make_progress(chapters: list[dict]) -> dict:
    return {
        "project_id": "proj_test",
        "current_chapter": len(chapters),
        "total_chapters": len(chapters),
        "current_stage": "STAGE4",
        "chapters": chapters,
        "circuit_breaker_events": [],
    }


def _make_engine(projects_dir: Path) -> DiagnosisEngine:
    return DiagnosisEngine("proj_test", projects_dir)


# ── Timeline Detection ──────────────────────────────────────────


class TestTimelineDetection:
    def test_no_issues_when_no_scenes(self, projects_dir):
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([]))
        engine = _make_engine(projects_dir)
        report = engine.diagnose()
        assert report["summary"]["p0_count"] == 0

    def test_detects_location_jump_between_chapters(self, projects_dir):
        """AC-5: Location jump — character at A in ch1, at B in ch2 without from=A."""
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [
                {"scene_number": 1, "status": "completed", "coherence_score": 85},
            ]},
            {"chapter_number": 2, "status": "completed", "scenes": [
                {"scene_number": 2, "status": "completed", "coherence_score": 85},
            ]},
        ]))

        # Chapter 1: character arrives at location A
        _write_md(projects_dir, "proj_test", "chapters/scene_001_draft.md",
            '林峰站在城西烂尾楼的废墟上。\n'
            '<!-- SF_LOG character_emotion char="林峰" emotion="愤怒" -->\n'
            '<!-- SF_LOG character_location_change char="林峰" from="未知" to="城西烂尾楼" -->\n'
        )

        # Chapter 2: character at location B, from="未知" (no proper transition)
        _write_md(projects_dir, "proj_test", "chapters/scene_002_draft.md",
            '林峰回到家中，疲惫地坐在沙发上。\n'
            '<!-- SF_LOG character_emotion char="林峰" emotion="疲惫" -->\n'
            '<!-- SF_LOG character_location_change char="林峰" from="未知" to="家中" -->\n'
        )

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        timeline_issues = [i for i in report["issues"] if i["category"] == "timeline_break"]
        assert len(timeline_issues) >= 1
        issue = timeline_issues[0]
        assert issue["priority"] == "P0"
        assert "林峰" in issue["description"]

    def test_no_timeline_issue_with_proper_transition(self, projects_dir):
        """When location change has correct 'from' field, no issue should be raised."""
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [
                {"scene_number": 1, "status": "completed", "coherence_score": 85},
            ]},
            {"chapter_number": 2, "status": "completed", "scenes": [
                {"scene_number": 2, "status": "completed", "coherence_score": 85},
            ]},
        ]))

        _write_md(projects_dir, "proj_test", "chapters/scene_001_draft.md",
            '<!-- SF_LOG character_location_change char="林峰" from="未知" to="城西烂尾楼" -->\n'
        )
        _write_md(projects_dir, "proj_test", "chapters/scene_002_draft.md",
            '<!-- SF_LOG character_location_change char="林峰" from="城西烂尾楼" to="家中" -->\n'
        )

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        timeline_issues = [i for i in report["issues"] if i["category"] == "timeline_break"]
        assert len(timeline_issues) == 0

    def test_multiple_characters_timeline(self, projects_dir):
        """Multiple characters: one with proper transition, one without."""
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [
                {"scene_number": 1, "status": "completed", "coherence_score": 85},
            ]},
            {"chapter_number": 2, "status": "completed", "scenes": [
                {"scene_number": 2, "status": "completed", "coherence_score": 85},
            ]},
        ]))

        _write_md(projects_dir, "proj_test", "chapters/scene_001_draft.md",
            '<!-- SF_LOG character_location_change char="林峰" from="未知" to="实验室" -->\n'
            '<!-- SF_LOG character_location_change char="苏晓晓" from="未知" to="咖啡馆" -->\n'
        )
        # 林峰: from="未知" (jump), 苏晓晓: proper from
        _write_md(projects_dir, "proj_test", "chapters/scene_002_draft.md",
            '<!-- SF_LOG character_location_change char="林峰" from="未知" to="医院" -->\n'
            '<!-- SF_LOG character_location_change char="苏晓晓" from="咖啡馆" to="医院" -->\n'
        )

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        timeline_issues = [i for i in report["issues"] if i["category"] == "timeline_break"]
        # 林峰: lab -> hospital without from="实验室" → issue
        lin_issues = [i for i in timeline_issues if "林峰" in i["description"]]
        su_issues = [i for i in timeline_issues if "苏晓晓" in i["description"]]
        assert len(lin_issues) >= 1
        assert len(su_issues) == 0

    def test_location_jump_same_chapter_no_issue(self, projects_dir):
        """Location changes within the same chapter with proper from= are fine."""
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [
                {"scene_number": 1, "status": "completed", "coherence_score": 85},
                {"scene_number": 2, "status": "completed", "coherence_score": 85},
            ]},
        ]))

        _write_md(projects_dir, "proj_test", "chapters/scene_001_draft.md",
            '<!-- SF_LOG character_location_change char="林峰" from="未知" to="实验室" -->\n'
        )
        _write_md(projects_dir, "proj_test", "chapters/scene_002_draft.md",
            '<!-- SF_LOG character_location_change char="林峰" from="实验室" to="办公室" -->\n'
        )

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        timeline_issues = [i for i in report["issues"] if i["category"] == "timeline_break"]
        assert len(timeline_issues) == 0


# ── Narrative Asset Legacy Detection ────────────────────────────


class TestNarrativeAssetDetection:
    def test_detects_unresolved_conflict(self, projects_dir):
        """Unresolved conflict should be flagged as P1."""
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [
                {"scene_number": 1, "status": "completed", "coherence_score": 85},
            ]},
        ]))
        _write_json(projects_dir, "proj_test", "storyos/conflicts.json", [
            {"id": "cf_001", "description": "林峰与师父的背叛冲突", "status": "active", "created_chapter": 1},
        ])

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        conflict_issues = [i for i in report["issues"] if i["category"] == "unresolved_conflict"]
        assert len(conflict_issues) >= 1
        assert conflict_issues[0]["priority"] == "P1"
        assert conflict_issues[0]["asset_id"] == "cf_001"

    def test_resolved_conflict_no_issue(self, projects_dir):
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [
                {"scene_number": 1, "status": "completed", "coherence_score": 85},
            ]},
        ]))
        _write_json(projects_dir, "proj_test", "storyos/conflicts.json", [
            {"id": "cf_001", "description": "冲突", "status": "resolved", "created_chapter": 1},
        ])

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        conflict_issues = [i for i in report["issues"] if i["category"] == "unresolved_conflict"]
        assert len(conflict_issues) == 0

    def test_detects_unrevealed_mystery(self, projects_dir):
        """Mystery created at ch1, now at ch4 (3 chapters since) → flag."""
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [{"scene_number": 1, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 2, "status": "completed", "scenes": [{"scene_number": 2, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 3, "status": "completed", "scenes": [{"scene_number": 3, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 4, "status": "completed", "scenes": [{"scene_number": 4, "status": "completed", "coherence_score": 85}]},
        ]))
        _write_json(projects_dir, "proj_test", "storyos/mysteries.json", [
            {"id": "mys_001", "question": "超脑的真正起源是什么？", "status": "open", "created_chapter": 1, "clues": []},
        ])

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        mystery_issues = [i for i in report["issues"] if i["category"] == "unrevealed_mystery"]
        assert len(mystery_issues) >= 1
        assert mystery_issues[0]["priority"] == "P1"

    def test_recent_mystery_no_issue(self, projects_dir):
        """Mystery created recently (< 3 chapters ago) shouldn't be flagged."""
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [{"scene_number": 1, "status": "completed", "coherence_score": 85}]},
        ]))
        _write_json(projects_dir, "proj_test", "storyos/mysteries.json", [
            {"id": "mys_001", "question": "新谜团", "status": "open", "created_chapter": 1, "clues": []},
        ])

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        mystery_issues = [i for i in report["issues"] if i["category"] == "unrevealed_mystery"]
        assert len(mystery_issues) == 0

    def test_detects_pending_promise(self, projects_dir):
        """Promise pending for 5+ chapters → flag."""
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [{"scene_number": 1, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 2, "status": "completed", "scenes": [{"scene_number": 2, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 3, "status": "completed", "scenes": [{"scene_number": 3, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 4, "status": "completed", "scenes": [{"scene_number": 4, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 5, "status": "completed", "scenes": [{"scene_number": 5, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 6, "status": "completed", "scenes": [{"scene_number": 6, "status": "completed", "coherence_score": 85}]},
        ]))
        _write_json(projects_dir, "proj_test", "storyos/promises.json", [
            {"id": "pr_001", "content": "林峰承诺保护苏晓晓", "status": "pending", "created_chapter": 1},
        ])

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        promise_issues = [i for i in report["issues"] if i["category"] == "pending_promise"]
        assert len(promise_issues) >= 1
        assert promise_issues[0]["priority"] == "P1"

    def test_fulfilled_promise_no_issue(self, projects_dir):
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [{"scene_number": 1, "status": "completed", "coherence_score": 85}]},
        ]))
        _write_json(projects_dir, "proj_test", "storyos/promises.json", [
            {"id": "pr_001", "content": "已兑现", "status": "fulfilled", "created_chapter": 1},
        ])

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        promise_issues = [i for i in report["issues"] if i["category"] == "pending_promise"]
        assert len(promise_issues) == 0

    def test_detects_unrevealed_twist_past_planned_chapter(self, projects_dir):
        """Twist planned for ch3, now at ch5 → flag."""
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [{"scene_number": 1, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 2, "status": "completed", "scenes": [{"scene_number": 2, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 3, "status": "completed", "scenes": [{"scene_number": 3, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 4, "status": "completed", "scenes": [{"scene_number": 4, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 5, "status": "completed", "scenes": [{"scene_number": 5, "status": "completed", "coherence_score": 85}]},
        ]))
        _write_json(projects_dir, "proj_test", "storyos/twists.json", [
            {"id": "tw_001", "description": "师父的真实身份", "status": "foreshadowing",
             "created_chapter": 1, "planned_reveal_chapter": 3},
        ])

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        twist_issues = [i for i in report["issues"] if i["category"] == "unrevealed_twist"]
        assert len(twist_issues) >= 1
        assert twist_issues[0]["priority"] == "P1"

    def test_twist_before_planned_chapter_no_issue(self, projects_dir):
        """Twist planned for ch5, now at ch3 → no issue yet."""
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [{"scene_number": 1, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 2, "status": "completed", "scenes": [{"scene_number": 2, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 3, "status": "completed", "scenes": [{"scene_number": 3, "status": "completed", "coherence_score": 85}]},
        ]))
        _write_json(projects_dir, "proj_test", "storyos/twists.json", [
            {"id": "tw_002", "description": "未来转折", "status": "foreshadowing",
             "created_chapter": 1, "planned_reveal_chapter": 5},
        ])

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        twist_issues = [i for i in report["issues"] if i["category"] == "unrevealed_twist"]
        assert len(twist_issues) == 0

    def test_detects_stalled_goal(self, projects_dir):
        """Goal stalled for 5+ chapters at early progress → flag as P2."""
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [{"scene_number": 1, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 2, "status": "completed", "scenes": [{"scene_number": 2, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 3, "status": "completed", "scenes": [{"scene_number": 3, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 4, "status": "completed", "scenes": [{"scene_number": 4, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 5, "status": "completed", "scenes": [{"scene_number": 5, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 6, "status": "completed", "scenes": [{"scene_number": 6, "status": "completed", "coherence_score": 85}]},
        ]))
        _write_json(projects_dir, "proj_test", "storyos/goals.json", [
            {"id": "goal_001", "content": "成为最强修行者", "status": "active", "progress": "T1", "created_chapter": 1},
        ])

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        goal_issues = [i for i in report["issues"] if i["category"] == "stalled_goal"]
        assert len(goal_issues) >= 1
        assert goal_issues[0]["priority"] == "P2"

    def test_detects_unrevealed_secret(self, projects_dir):
        """Secret hidden for 5+ chapters → flag."""
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [{"scene_number": 1, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 2, "status": "completed", "scenes": [{"scene_number": 2, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 3, "status": "completed", "scenes": [{"scene_number": 3, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 4, "status": "completed", "scenes": [{"scene_number": 4, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 5, "status": "completed", "scenes": [{"scene_number": 5, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 6, "status": "completed", "scenes": [{"scene_number": 6, "status": "completed", "coherence_score": 85}]},
        ]))
        _write_json(projects_dir, "proj_test", "storyos/reveals.json", [
            {"id": "rev_001", "content": "林峰的真实出身", "status": "hidden", "created_chapter": 1},
        ])

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        reveal_issues = [i for i in report["issues"] if i["category"] == "unrevealed_secret"]
        assert len(reveal_issues) >= 1
        assert reveal_issues[0]["priority"] == "P1"

    def test_detects_high_expectation(self, projects_dir):
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [{"scene_number": 1, "status": "completed", "coherence_score": 85}]},
        ]))
        _write_json(projects_dir, "proj_test", "storyos/expectations.json", [
            {"id": "exp_001", "content": "期待林峰与师父的决战", "intensity": 90, "status": "accumulating", "created_chapter": 1},
        ])

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        exp_issues = [i for i in report["issues"] if i["category"] == "high_expectation"]
        assert len(exp_issues) >= 1
        assert exp_issues[0]["priority"] == "P2"

    def test_low_intensity_expectation_no_issue(self, projects_dir):
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [{"scene_number": 1, "status": "completed", "coherence_score": 85}]},
        ]))
        _write_json(projects_dir, "proj_test", "storyos/expectations.json", [
            {"id": "exp_001", "content": "小期待", "intensity": 30, "status": "accumulating", "created_chapter": 1},
        ])

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        exp_issues = [i for i in report["issues"] if i["category"] == "high_expectation"]
        assert len(exp_issues) == 0


# ── Foreshadowing Integrity ─────────────────────────────────────


class TestForeshadowingIntegrity:
    def test_detects_dead_foreshadowing(self, projects_dir):
        """Dead foreshadowing should be flagged as P1."""
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [{"scene_number": 1, "status": "completed", "coherence_score": 85}]},
        ]))
        _write_json(projects_dir, "proj_test", "storyos/foreshadowing.json", [
            {"id": "fs_001", "description": "神秘人的身份暗示", "status": "dead", "created_chapter": 1, "clues": []},
        ])

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        fs_issues = [i for i in report["issues"] if i["category"] == "dead_foreshadowing"]
        assert len(fs_issues) >= 1
        assert fs_issues[0]["priority"] == "P1"
        assert fs_issues[0]["asset_id"] == "fs_001"

    def test_detects_stale_foreshadowing(self, projects_dir):
        """Planted foreshadowing with no clues for >= 5 chapters → flag."""
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [{"scene_number": 1, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 2, "status": "completed", "scenes": [{"scene_number": 2, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 3, "status": "completed", "scenes": [{"scene_number": 3, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 4, "status": "completed", "scenes": [{"scene_number": 4, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 5, "status": "completed", "scenes": [{"scene_number": 5, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 6, "status": "completed", "scenes": [{"scene_number": 6, "status": "completed", "coherence_score": 85}]},
        ]))
        _write_json(projects_dir, "proj_test", "storyos/foreshadowing.json", [
            {"id": "fs_002", "description": "古老封印的伏笔", "status": "planted", "created_chapter": 1, "clues": []},
        ])

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        stale_issues = [i for i in report["issues"] if i["category"] == "stale_foreshadowing"]
        assert len(stale_issues) >= 1
        assert stale_issues[0]["priority"] == "P1"

    def test_recent_foreshadowing_no_issue(self, projects_dir):
        """Planted foreshadowing < 5 chapters ago shouldn't be flagged."""
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [{"scene_number": 1, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 2, "status": "completed", "scenes": [{"scene_number": 2, "status": "completed", "coherence_score": 85}]},
        ]))
        _write_json(projects_dir, "proj_test", "storyos/foreshadowing.json", [
            {"id": "fs_003", "description": "新伏笔", "status": "planted", "created_chapter": 1, "clues": []},
        ])

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        stale_issues = [i for i in report["issues"] if i["category"] == "stale_foreshadowing"]
        assert len(stale_issues) == 0

    def test_revealed_foreshadowing_no_issue(self, projects_dir):
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [{"scene_number": 1, "status": "completed", "coherence_score": 85}]},
        ]))
        _write_json(projects_dir, "proj_test", "storyos/foreshadowing.json", [
            {"id": "fs_004", "description": "已揭示", "status": "revealed", "created_chapter": 1, "clues": []},
        ])

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        fs_issues = [i for i in report["issues"] if i["asset_id"] == "fs_004"]
        assert len(fs_issues) == 0


# ── Integration / AC-5 ──────────────────────────────────────────


class TestDiagnosisIntegration:
    def test_ac5_three_injected_issues(self, projects_dir):
        """
        AC-5: Inject 3 deliberate issues:
        1. Location jump (P0) — character moves without proper from=
        2. Unresolved conflict (P1)
        3. Dead foreshadowing (P1)
        → Verify diagnosis report outputs all 3 issues.
        """
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [
                {"scene_number": 1, "status": "completed", "coherence_score": 85},
            ]},
            {"chapter_number": 2, "status": "completed", "scenes": [
                {"scene_number": 2, "status": "completed", "coherence_score": 85},
            ]},
        ]))

        # Issue 1: Location jump — character at A in ch1, at B in ch2 with from="未知"
        _write_md(projects_dir, "proj_test", "chapters/scene_001_draft.md",
            '<!-- SF_LOG character_emotion char="林峰" emotion="愤怒" -->\n'
            '<!-- SF_LOG character_location_change char="林峰" from="未知" to="实验室" -->\n'
        )
        _write_md(projects_dir, "proj_test", "chapters/scene_002_draft.md",
            '<!-- SF_LOG character_emotion char="林峰" emotion="紧张" -->\n'
            '<!-- SF_LOG character_location_change char="林峰" from="未知" to="废弃工厂" -->\n'
        )

        # Issue 2: Unresolved conflict
        _write_json(projects_dir, "proj_test", "storyos/conflicts.json", [
            {"id": "cf_inject", "description": "林峰与神秘人的生死冲突", "status": "active", "created_chapter": 1},
        ])

        # Issue 3: Dead foreshadowing
        _write_json(projects_dir, "proj_test", "storyos/foreshadowing.json", [
            {"id": "fs_dead", "description": "关于超脑的暗示", "status": "dead", "created_chapter": 1, "clues": []},
        ])

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        # Should have at least 3 issues
        assert len(report["issues"]) >= 3, f"Expected >= 3 issues, got {len(report['issues'])}: {[i['category'] for i in report['issues']]}"

        # Check P0
        p0_issues = [i for i in report["issues"] if i["priority"] == "P0"]
        assert len(p0_issues) >= 1
        assert any("timeline" in i["category"] for i in p0_issues)

        # Check P1
        p1_issues = [i for i in report["issues"] if i["priority"] == "P1"]
        assert len(p1_issues) >= 2

        categories = {i["category"] for i in p1_issues}
        assert "unresolved_conflict" in categories
        assert "dead_foreshadowing" in categories

        # Verify summary counts
        assert report["summary"]["p0_count"] >= 1
        assert report["summary"]["p1_count"] >= 2

    def test_report_saved_to_file(self, projects_dir):
        """Diagnosis report should be saved to diagnosis_report.json."""
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([]))

        engine = _make_engine(projects_dir)
        engine.diagnose()

        saved_path = projects_dir / "proj_test" / "diagnosis_report.json"
        assert saved_path.exists(), f"Expected {saved_path} to exist"

        with open(saved_path, "r", encoding="utf-8") as f:
            saved = json.load(f)
        assert saved["project_id"] == "proj_test"
        assert "issues" in saved
        assert "summary" in saved

    def test_empty_project_no_issues(self, projects_dir):
        """Empty project with no registries and no scenes should have 0 issues."""
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([]))

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        assert report["summary"]["p0_count"] == 0
        assert report["summary"]["p1_count"] == 0
        assert report["summary"]["p2_count"] == 0
        assert len(report["issues"]) == 0

    def test_missing_registry_files_no_error(self, projects_dir):
        """Missing registry files should not cause errors."""
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [
                {"scene_number": 1, "status": "completed", "coherence_score": 85},
            ]},
        ]))

        engine = _make_engine(projects_dir)
        report = engine.diagnose()
        assert "issues" in report
        assert "summary" in report

    def test_issue_ids_are_unique(self, projects_dir):
        """All issues should have unique IDs."""
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [{"scene_number": 1, "status": "completed", "coherence_score": 85}]},
        ]))
        _write_json(projects_dir, "proj_test", "storyos/conflicts.json", [
            {"id": "cf_a", "description": "冲突A", "status": "active", "created_chapter": 1},
            {"id": "cf_b", "description": "冲突B", "status": "active", "created_chapter": 1},
        ])

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        ids = [i["id"] for i in report["issues"]]
        assert len(ids) == len(set(ids))

    def test_priority_distribution(self, projects_dir):
        """Verify issue priorities are correctly assigned."""
        _write_json(projects_dir, "proj_test", "progress.json", _make_progress([
            {"chapter_number": 1, "status": "completed", "scenes": [{"scene_number": 1, "status": "completed", "coherence_score": 85}]},
            {"chapter_number": 2, "status": "completed", "scenes": [{"scene_number": 2, "status": "completed", "coherence_score": 85}]},
        ]))
        _write_json(projects_dir, "proj_test", "storyos/conflicts.json", [
            {"id": "cf_001", "description": "冲突", "status": "active", "created_chapter": 1},
        ])
        _write_json(projects_dir, "proj_test", "storyos/promises.json", [
            {"id": "pr_001", "content": "承诺", "status": "pending", "created_chapter": 2},
        ])

        engine = _make_engine(projects_dir)
        report = engine.diagnose()

        for issue in report["issues"]:
            assert issue["priority"] in ("P0", "P1", "P2")
            assert issue["category"] != ""
            assert issue["description"] != ""
            assert issue["suggestion"] != ""
            assert issue["status"] == "open"
