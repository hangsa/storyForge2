"""Tests for Branch Simulator — deterministic + LLM two-phase analysis."""
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, AsyncMock, patch

import pytest

from backend.conductor.branch_simulator import BranchSimulator
from backend.models.branch_simulation import BranchSimulationReport, LLMInference


@pytest.fixture
def temp_dir():
    d = tempfile.mkdtemp()
    yield Path(d)
    import shutil
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def mock_router():
    router = MagicMock()
    router.execute = AsyncMock(return_value={
        "content": '{"tension_curve": {"content": "预测文本", "confidence": "medium"}, '
                   '"foreshadowing_risk": {"content": "风险文本", "confidence": "medium"}, '
                   '"alternative_suggestions": {"content": "替代文本", "confidence": "low"}}',
        "usage": {"input": 1000, "output": 400},
        "model": "claude-sonnet-4",
        "tier": "tier_2",
        "cost": 0.01,
    })
    return router


@pytest.fixture
def mock_impact_analyzer():
    return MagicMock()


@pytest.fixture
def simulator(temp_dir, mock_router, mock_impact_analyzer):
    return BranchSimulator(
        projects_dir=temp_dir,
        model_router=mock_router,
        impact_analyzer=mock_impact_analyzer,
    )


class TestBranchSimulatorInit:

    def test_initialization(self, simulator, mock_router, mock_impact_analyzer):
        assert simulator._router is mock_router
        assert simulator._impact_analyzer is mock_impact_analyzer

    def test_projects_dir_set(self, simulator, temp_dir):
        assert simulator._projects_dir == temp_dir


class TestDeterministicAnalysis:

    def test_empty_project_returns_safe_defaults(self, simulator):
        result = simulator._run_deterministic("nonexistent", "test description")
        assert result["chapter_range"] == (1, 1)
        assert result["characters"] == []
        assert result["foreshadowings"] == []


class TestLLMInference:

    @pytest.mark.asyncio
    async def test_simulate_runs_deterministic(self, simulator):
        with patch.object(simulator, '_run_deterministic', return_value={
            "chapter_range": (1, 3),
            "characters": ["主角"],
            "foreshadowings": ["伏笔A"],
            "growth_shifts": {},
            "reader_metrics": {"curiosity": "↑5"},
        }):
            report = await simulator.simulate("test_project", "改变主角的职业选择")
            assert isinstance(report, BranchSimulationReport)
            assert report.affected_chapter_range == (1, 3)
            assert "主角" in report.affected_characters

    @pytest.mark.asyncio
    async def test_simulate_produces_llm_inferences(self, simulator):
        with patch.object(simulator, '_run_deterministic', return_value={
            "chapter_range": (1, 2),
            "characters": [],
            "foreshadowings": [],
            "growth_shifts": {},
            "reader_metrics": {},
        }):
            report = await simulator.simulate("test_project", "改变世界观规则")
            assert report.tension_curve_projection is not None
            assert report.tension_curve_projection.confidence == "medium"
            assert report.foreshadowing_risk_assessment is not None
            assert report.alternative_suggestions is not None
            assert report.alternative_suggestions.confidence == "low"

    @pytest.mark.asyncio
    async def test_simulate_llm_failure_graceful_degradation(self, simulator, mock_router):
        mock_router.execute = AsyncMock(return_value={
            "content": "", "usage": {"input": 0, "output": 0},
            "model": "none", "tier": "tier_2", "cost": 0.0,
        })
        with patch.object(simulator, '_run_deterministic', return_value={
            "chapter_range": (1, 1), "characters": [], "foreshadowings": [],
            "growth_shifts": {}, "reader_metrics": {},
        }):
            report = await simulator.simulate("test_project", "test")
            assert report.tokens_used_total == 0

    @pytest.mark.asyncio
    async def test_simulate_passes_through_high_confidence(self, simulator):
        with patch.object(simulator, '_run_deterministic', return_value={
            "chapter_range": (1, 1), "characters": [], "foreshadowings": [],
            "growth_shifts": {}, "reader_metrics": {},
        }):
            # Override the mock router to return high confidence
            simulator._router.execute = AsyncMock(return_value={
                "content": '{"tension_curve": {"content": "明确", "confidence": "high"}}',
                "usage": {"input": 100, "output": 50},
                "model": "sonnet",
            })
            report = await simulator.simulate("test_project", "test")
            assert report.tension_curve_projection is not None
            assert report.tension_curve_projection.confidence == "high"


class TestBranchSimulationReport:

    def test_report_fields(self):
        report = BranchSimulationReport(
            branch_point_description="test",
            affected_chapter_range=(1, 3),
            affected_characters=["林峰"],
            affected_foreshadowings=["伏笔1"],
            growth_curve_shifts={"林峰": 2},
            reader_metrics_projection={"tension": "↑10", "curiosity": "↑5"},
            tension_curve_projection=LLMInference(
                content="张力预测", confidence="medium", model="claude-sonnet-4"
            ),
            foreshadowing_risk_assessment=LLMInference(
                content="风险评估", confidence="medium", model="claude-sonnet-4"
            ),
            alternative_suggestions=LLMInference(
                content="替代方案", confidence="low", model="claude-sonnet-4"
            ),
            created_at="2026-06-18T00:00:00",
            tokens_used_total=1500,
        )
        assert report.affected_chapter_range == (1, 3)
        assert len(report.affected_characters) == 1
        assert report.tension_curve_projection.confidence == "medium"
        assert report.alternative_suggestions.confidence == "low"
