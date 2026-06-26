"""Tests for BranchSimulator save_report / list_history file I/O roundtrip."""
import json
import tempfile
import time
from pathlib import Path
from unittest.mock import MagicMock, AsyncMock

import pytest

from backend.conductor.branch_simulator import BranchSimulator
from backend.models.branch_simulation import BranchSimulationReport, LLMInference


@pytest.fixture
def project_dir():
    d = Path(tempfile.mkdtemp())
    pid = "proj_abc"
    (d / pid).mkdir(parents=True)
    yield d, pid
    import shutil
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def simulator(project_dir):
    d, _ = project_dir
    router = MagicMock()
    router.execute = AsyncMock(return_value={"content": "", "usage": {"input": 0, "output": 0}})
    return BranchSimulator(projects_dir=d, model_router=router)


def test_save_report_writes_to_branches_directory(simulator, project_dir):
    d, pid = project_dir
    report = BranchSimulationReport(
        branch_point_description="测试分支",
        affected_chapter_range=(1, 5),
        affected_characters=["林峰"],
        affected_foreshadowings=["mys_001"],
        growth_curve_shifts={"林峰": 2},
        reader_metrics_projection={"tension": "↑10"},
        tension_curve_projection=LLMInference(
            content="预测文本", confidence="medium", model="sonnet", tokens_used=200,
        ),
        created_at="2026-06-26T00:00:00",
        tokens_used_total=200,
    )
    path = simulator.save_report(pid, report)
    assert path.exists()
    assert path.parent == d / pid / "branches"
    assert path.name.endswith("_simulation.json")
    data = json.loads(path.read_text(encoding="utf-8"))
    assert data["branch_point_description"] == "测试分支"
    assert data["affected_chapter_range"] == [1, 5]
    assert data["tension_curve_projection"]["content"] == "预测文本"
    assert data["tension_curve_projection"]["confidence"] == "medium"


def test_list_history_returns_saved_reports(simulator, project_dir):
    d, pid = project_dir
    r1 = BranchSimulationReport(
        branch_point_description="第一个",
        affected_chapter_range=(1, 1),
        created_at="2026-06-25T00:00:00",
    )
    r2 = BranchSimulationReport(
        branch_point_description="第二个",
        affected_chapter_range=(2, 2),
        created_at="2026-06-26T00:00:00",
    )
    simulator.save_report(pid, r1)
    # Filename uses 1-second-resolution timestamp; sleep to ensure distinct files.
    time.sleep(1.1)
    simulator.save_report(pid, r2)
    history = simulator.list_history(pid)
    assert len(history) == 2
    descriptions = [h["description"] for h in history]
    assert "第一个" in descriptions
    assert "第二个" in descriptions
    # Sorted descending by filename (most recent first)
    assert history[0]["id"] >= history[1]["id"]


def test_list_history_empty_when_no_branches_dir(simulator, project_dir):
    d, pid = project_dir
    history = simulator.list_history(pid)
    assert history == []


def test_save_report_omits_none_inference_fields(simulator, project_dir):
    d, pid = project_dir
    report = BranchSimulationReport(
        branch_point_description="无 LLM 推理",
        affected_chapter_range=(1, 1),
    )
    path = simulator.save_report(pid, report)
    data = json.loads(path.read_text(encoding="utf-8"))
    assert "tension_curve_projection" not in data
    assert "foreshadowing_risk_assessment" not in data
    assert "alternative_suggestions" not in data
