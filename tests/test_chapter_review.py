"""Tests for ChapterReviewBuilder and CoherenceScorer."""
import json
import pytest
from backend.conductor.chapter_review import (
    ChapterReviewBuilder,
    CoherenceScorer,
)


class TestCoherenceScorer:
    def test_rule_score_in_range(self):
        scorer = CoherenceScorer()
        score = scorer._compute_rule_score(
            narrative_health=70.0,
            reader_os_avg=65.0,
            fact_guard_pass_rate=0.85,
        )
        assert 0 <= score <= 100

    def test_rule_score_all_perfect(self):
        scorer = CoherenceScorer()
        score = scorer._compute_rule_score(
            narrative_health=100.0,
            reader_os_avg=100.0,
            fact_guard_pass_rate=1.0,
        )
        assert score == 60  # 100*0.2 + 100*0.2 + 100*0.2 = 60 (rule is 60% of total)

    def test_rule_score_all_zero(self):
        scorer = CoherenceScorer()
        score = scorer._compute_rule_score(
            narrative_health=0.0,
            reader_os_avg=0.0,
            fact_guard_pass_rate=0.0,
        )
        assert score == 0

    def test_clamp_delta(self):
        scorer = CoherenceScorer()
        assert scorer._clamp_delta(15) == 10
        assert scorer._clamp_delta(-15) == -10
        assert scorer._clamp_delta(5) == 5
        assert scorer._clamp_delta(-3) == -3

    def test_compute_final(self):
        scorer = CoherenceScorer()
        # rule=95 + delta=10 -> clamped to 100
        assert scorer._compute_final(95, 10) == 100
        # rule=5 + delta=-10 -> clamped to 0
        assert scorer._compute_final(5, -10) == 0
        # normal case
        assert scorer._compute_final(50, 5) == 55


class TestChapterReviewBuilder:
    @pytest.fixture
    def builder(self, tmp_path):
        projects_dir = tmp_path / "projects"
        proj_dir = projects_dir / "test_proj"
        (proj_dir / "memory" / "l2").mkdir(parents=True)
        (proj_dir / "storyos").mkdir(parents=True)
        (proj_dir / "chapters").mkdir(parents=True)
        (proj_dir / "progress.json").write_text(json.dumps({
            "project_id": "test_proj",
            "current_chapter": 3,
            "chapters": [
                {
                    "chapter_number": 3,
                    "status": "in_progress",
                    "scenes": [
                        {"scene_number": 1, "status": "completed", "retry_count": 0},
                        {"scene_number": 2, "status": "completed", "retry_count": 1},
                        {"scene_number": 3, "status": "completed", "retry_count": 0},
                    ],
                }
            ],
            "circuit_breaker_events": [
                {"scene_number": 1, "attempt": 1, "result": "passed"},
                {"scene_number": 2, "attempt": 1, "result": "retry"},
                {"scene_number": 2, "attempt": 2, "result": "passed"},
                {"scene_number": 3, "attempt": 1, "result": "passed"},
            ],
        }), encoding="utf-8")
        return ChapterReviewBuilder("test_proj", projects_dir=projects_dir)

    def test_all_scenes_done_returns_true(self, builder):
        assert builder._all_scenes_done(3) is True

    def test_all_scenes_done_returns_false_for_incomplete(self, builder):
        assert builder._all_scenes_done(4) is False

    def test_build_review_returns_valid_structure(self, builder):
        review = builder.build_review(3)
        assert review["chapter_number"] == 3
        assert "timestamp" in review
        assert 0 <= review["coherence_score"] <= 100
        assert isinstance(review["coherence_comment"], str)
        assert len(review["reader_os"]) == 7
        assert "addiction" in review["reader_os"]
        assert "narrative_assets" in review
        assert review["writing_formula_compliance"] == []
        assert review["discussion_topics"] == []
        assert review["decision"] is None

    def test_build_review_fact_guard_summary(self, builder):
        review = builder.build_review(3)
        fgs = review["fact_guard_summary"]
        assert fgs["total"] == 4
        assert fgs["passed"] == 3
        assert fgs["failed"] == 1
        assert fgs["pass_rate"] == 0.75

    def test_get_review_data_returns_none_for_missing(self, builder):
        result = builder.get_review_data(99)
        assert result is None

    def test_save_and_load_review(self, builder, tmp_path):
        projects_dir = tmp_path / "projects"
        builder._projects_dir = projects_dir
        builder._project_dir = projects_dir / "test_proj"
        review = builder.build_review(3)
        builder._save_review(review)
        loaded = builder.get_review_data(3)
        assert loaded is not None
        assert loaded["chapter_number"] == 3

    def test_set_decision_approved(self, builder, tmp_path):
        projects_dir = tmp_path / "projects"
        builder._projects_dir = projects_dir
        builder._project_dir = projects_dir / "test_proj"
        review = builder.build_review(3)
        builder._save_review(review)
        result = builder.set_decision(3, "approved")
        assert result is True
        loaded = builder.get_review_data(3)
        assert loaded["decision"] == "approved"

    def test_set_decision_revise_with_feedback(self, builder, tmp_path):
        projects_dir = tmp_path / "projects"
        builder._projects_dir = projects_dir
        builder._project_dir = projects_dir / "test_proj"
        review = builder.build_review(3)
        builder._save_review(review)
        result = builder.set_decision(3, "revise", "请重写第2幕的打斗场景")
        assert result is True
        loaded = builder.get_review_data(3)
        assert loaded["decision"] == "revise"
        assert "打斗场景" in loaded["decision_feedback"]

    def test_set_decision_invalid_value(self, builder):
        result = builder.set_decision(3, "invalid")
        assert result is False

    def test_set_decision_missing_review(self, builder):
        result = builder.set_decision(99, "approved")
        assert result is False
