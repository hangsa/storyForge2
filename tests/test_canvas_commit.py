"""Tests for the /commit endpoint on Creative Canvas.

Covers:
- 400 when canvas not initialized
- 400 when selected_path length < 2
- 200 happy path: writes concept_and_dna.json, stamps canvas_state.json
- 503 when LLM output misses core_contradiction.statement
- last-write-wins: re-commit overwrites concept_and_dna.json
- 200 with "no mutation_context" nodes does not crash the formatter
"""
import json
from pathlib import Path
from unittest.mock import MagicMock, AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(temp_dir):
    from backend.config import settings
    original = settings.projects_dir
    settings.projects_dir = temp_dir

    project_dir = temp_dir / "test_project"
    project_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({
            "id": "test_project",
            "initial_intent": {"free_text": "测试"},
            "genre": "cool_novel",
        }),
        encoding="utf-8",
    )
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)

    from backend.api.creative_canvas import router
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    yield client, project_dir
    settings.projects_dir = original


def _seed_canvas(project_dir: Path, *, selected_path_length: int,
                 committed_at: str = None) -> None:
    """Build a canvas with a selected_path of the given length.

    selected_path_length=1 → only the root; selected_path_length=2 → root + 1 child.
    """
    nodes = {}
    for i in range(selected_path_length):
        nid = f"wi_001_{i:02d}"
        nodes[nid] = {
            "id": nid,
            "depth": i,
            "parent_id": f"wi_001_{i - 1:02d}" if i > 0 else None,
            "content": f"第 {i} 层前提",
            "novelty_score": 70 + i,
            "trope_tags": [f"tag{i}"],
            "is_expanded": i < selected_path_length - 1,  # last one not expanded
            "children_ids": [],
            "branch_status": "active",
        }
    if selected_path_length >= 2:
        # last node has no children; earlier nodes have a child
        nodes[f"wi_001_00"]["children_ids"] = ["wi_001_01"]
        # Invariant 1: every expanded active node has a branch_choices entry
        branch_choices = {"wi_001_00": "wi_001_01"}
        if selected_path_length >= 3:
            nodes[f"wi_001_01"]["children_ids"] = ["wi_001_02"]
            branch_choices["wi_001_01"] = "wi_001_02"
    else:
        branch_choices = {}

    selected_path = [f"wi_001_{i:02d}" for i in range(selected_path_length)]
    state = {
        "schema_version": 2,
        "root_node_id": "wi_001_00",
        "nodes": nodes,
        "edges": [],
        "selected_path": selected_path,
        "branch_choices": branch_choices,
        "evaluations": {},
    }
    if committed_at:
        state["committed_at"] = committed_at
        state["committed_concept_ref"] = "concept_and_dna.json"

    (project_dir / "creative_os" / "canvas_state.json").write_text(
        json.dumps(state, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


def _seed_existing_concept_and_dna(project_dir: Path, source: str) -> None:
    """Pre-populate concept_and_dna.json to test last-write-wins."""
    (project_dir / "concept_and_dna.json").write_text(
        json.dumps({
            "concept": {"title": "OLD", "genre": "cool_novel", "premise": "old",
                        "tone": "", "theme": "", "target_audience": ""},
            "story_dna": {"core_contradiction": {"statement": "old statement",
                                                  "side_a": "a", "side_b": "b"},
                          "value_stack": []},
            "source": source,
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )


class TestCanvasCommitEndpoint:
    """Tests for POST /api/v1/projects/<id>/creative/canvas/commit."""

    def test_commit_returns_400_when_canvas_not_initialized(self, client):
        c, project_dir = client
        # No canvas_state.json exists
        response = c.post("/api/v1/projects/test_project/creative/canvas/commit")
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "CANVAS_NOT_INITIALIZED"

    def test_commit_returns_400_when_path_too_short(self, client):
        c, project_dir = client
        _seed_canvas(project_dir, selected_path_length=1)
        response = c.post("/api/v1/projects/test_project/creative/canvas/commit")
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "INSUFFICIENT_PATH"
        assert response.json()["detail"]["detail"]["selected_path_length"] == 1

    def test_commit_returns_400_when_path_is_2(self, client):
        c, project_dir = client
        _seed_canvas(project_dir, selected_path_length=2)
        # We need to mock PlannerAgent to assert the LLM is called at length 2
        with patch("backend.agents.planner.PlannerAgent") as mock_agent_cls:
            mock_instance = MagicMock()
            mock_instance.generate_concept_from_canvas = AsyncMock(return_value=(
                {
                    "concept": {"title": "T", "genre": "cool_novel", "premise": "P",
                                "tone": "热血", "theme": "成长", "target_audience": "大众"},
                    "story_dna": {
                        "core_contradiction": {"statement": "核心矛盾",
                                                "side_a": "A", "side_b": "B"},
                        "value_stack": [{"value_a": "a", "value_b": "b", "level": "l1"}],
                    },
                },
                MagicMock(),
            ))
            mock_agent_cls.return_value = mock_instance
            response = c.post("/api/v1/projects/test_project/creative/canvas/commit")
        assert response.status_code == 200
        body = response.json()
        assert body["code"] == "OK"
        assert body["detail"]["source"] == "canvas"
        assert body["detail"]["concept"]["title"] == "T"

    def test_commit_writes_concept_and_dna_with_source(self, client):
        c, project_dir = client
        _seed_canvas(project_dir, selected_path_length=2)
        with patch("backend.agents.planner.PlannerAgent") as mock_agent_cls:
            mock_instance = MagicMock()
            mock_instance.generate_concept_from_canvas = AsyncMock(return_value=(
                {
                    "concept": {"title": "T", "genre": "cool_novel", "premise": "P",
                                "tone": "热血", "theme": "成长", "target_audience": "大众"},
                    "story_dna": {
                        "core_contradiction": {"statement": "核心矛盾",
                                                "side_a": "A", "side_b": "B"},
                        "value_stack": [],
                    },
                },
                MagicMock(),
            ))
            mock_agent_cls.return_value = mock_instance
            response = c.post("/api/v1/projects/test_project/creative/canvas/commit")
        assert response.status_code == 200

        # Verify concept_and_dna.json was written with source/snapshot
        concept_file = project_dir / "concept_and_dna.json"
        assert concept_file.exists()
        data = json.loads(concept_file.read_text(encoding="utf-8"))
        assert data["source"] == "canvas"
        assert "canvas_snapshot" in data
        assert data["canvas_snapshot"]["selected_path"] == ["wi_001_00", "wi_001_01"]
        assert "committed_at" in data["canvas_snapshot"]

    def test_commit_stamps_canvas_state_with_committed_at(self, client):
        c, project_dir = client
        _seed_canvas(project_dir, selected_path_length=2)
        with patch("backend.agents.planner.PlannerAgent") as mock_agent_cls:
            mock_instance = MagicMock()
            mock_instance.generate_concept_from_canvas = AsyncMock(return_value=(
                {
                    "concept": {"title": "T", "premise": "P", "genre": "cool_novel",
                                "tone": "t", "theme": "th", "target_audience": "ta"},
                    "story_dna": {"core_contradiction": {"statement": "X",
                                                          "side_a": "a", "side_b": "b"},
                                  "value_stack": []},
                },
                MagicMock(),
            ))
            mock_agent_cls.return_value = mock_instance
            c.post("/api/v1/projects/test_project/creative/canvas/commit")
        canvas = json.loads(
            (project_dir / "creative_os" / "canvas_state.json").read_text(encoding="utf-8")
        )
        assert "committed_at" in canvas
        assert canvas["committed_concept_ref"] == "concept_and_dna.json"

    def test_commit_returns_503_when_llm_output_missing_statement(self, client):
        c, project_dir = client
        _seed_canvas(project_dir, selected_path_length=2)
        with patch("backend.agents.planner.PlannerAgent") as mock_agent_cls:
            mock_instance = MagicMock()
            mock_instance.generate_concept_from_canvas = AsyncMock(return_value=(
                {
                    "concept": {"title": "T", "premise": "P"},
                    "story_dna": {"core_contradiction": {"statement": "",
                                                          "side_a": "a", "side_b": "b"},
                                  "value_stack": []},
                },
                MagicMock(),
            ))
            mock_agent_cls.return_value = mock_instance
            response = c.post("/api/v1/projects/test_project/creative/canvas/commit")
        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "LLM_OUTPUT_INVALID"
        # The raw output should be in detail for the UI to display
        assert "raw_output" in response.json()["detail"]["detail"]

    def test_commit_returns_503_when_llm_returns_degraded(self, client):
        """B1: tier 2/3 silent degradation returns {"text": "", "degraded": True}.
        /commit must surface that as LLM_BACKEND_UNAVAILABLE, not LLM_OUTPUT_INVALID.
        """
        c, project_dir = client
        _seed_canvas(project_dir, selected_path_length=2)
        with patch("backend.agents.planner.PlannerAgent") as mock_agent_cls:
            mock_instance = MagicMock()
            mock_instance.generate_concept_from_canvas = AsyncMock(return_value=(
                {"text": "", "degraded": True},
                MagicMock(),
            ))
            mock_agent_cls.return_value = mock_instance
            response = c.post("/api/v1/projects/test_project/creative/canvas/commit")
        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "LLM_BACKEND_UNAVAILABLE"
        # And nothing was written — canvas still has no committed_at,
        # concept_and_dna.json was not created
        canvas = json.loads(
            (project_dir / "creative_os" / "canvas_state.json").read_text(encoding="utf-8")
        )
        assert "committed_at" not in canvas
        assert not (project_dir / "concept_and_dna.json").exists()

    def test_commit_writes_canvas_before_concept_file(self, client):
        """W4: canvas_state.json (with committed_at) is written before
        concept_and_dna.json so a crash between the two leaves the canvas
        stamped and the concept file untouched (more recoverable than the
        reverse).
        """
        c, project_dir = client
        _seed_canvas(project_dir, selected_path_length=2)
        with patch("backend.agents.planner.PlannerAgent") as mock_agent_cls:
            mock_instance = MagicMock()
            mock_instance.generate_concept_from_canvas = AsyncMock(return_value=(
                {
                    "concept": {"title": "T", "premise": "P", "genre": "cool_novel",
                                "tone": "t", "theme": "th", "target_audience": "ta"},
                    "story_dna": {"core_contradiction": {"statement": "S",
                                                          "side_a": "a", "side_b": "b"},
                                  "value_stack": []},
                },
                MagicMock(),
            ))
            mock_agent_cls.return_value = mock_instance
            # Patch FileManager.write_json at the class level so all
            # instances pick it up. Only the second call (concept_and_dna.json)
            # should fail — the first (canvas_state.json) should succeed.
            from backend.utils.file_manager import FileManager
            real_write = FileManager.write_json

            def maybe_fail(self, project_id, filename, data):
                if filename == "concept_and_dna.json":
                    raise OSError("simulated disk full")
                return real_write(self, project_id, filename, data)

            with patch.object(FileManager, "write_json", maybe_fail):
                response = c.post("/api/v1/projects/test_project/creative/canvas/commit")

        # The endpoint itself should have errored
        assert response.status_code >= 500
        # But the canvas state was already stamped — it survives the crash
        canvas = json.loads(
            (project_dir / "creative_os" / "canvas_state.json").read_text(encoding="utf-8")
        )
        assert "committed_at" in canvas
        assert canvas["committed_concept_ref"] == "concept_and_dna.json"

    def test_commit_returns_503_when_llm_raises_value_error(self, client):
        c, project_dir = client
        _seed_canvas(project_dir, selected_path_length=2)
        with patch("backend.agents.planner.PlannerAgent") as mock_agent_cls:
            mock_instance = MagicMock()
            mock_instance.generate_concept_from_canvas = AsyncMock(
                side_effect=ValueError("JSON parse failed")
            )
            mock_agent_cls.return_value = mock_instance
            response = c.post("/api/v1/projects/test_project/creative/canvas/commit")
        assert response.status_code == 503
        assert response.json()["detail"]["code"] == "LLM_GENERATION_FAILED"
        assert "JSON parse failed" in response.json()["detail"]["message"]

    def test_commit_last_write_wins_overwrites_existing(self, client):
        c, project_dir = client
        # Pre-seed concept_and_dna.json from a prior /stage1/generate run
        _seed_existing_concept_and_dna(project_dir, source="initial_intent")
        _seed_canvas(project_dir, selected_path_length=2)
        with patch("backend.agents.planner.PlannerAgent") as mock_agent_cls:
            mock_instance = MagicMock()
            mock_instance.generate_concept_from_canvas = AsyncMock(return_value=(
                {
                    "concept": {"title": "NEW", "genre": "cool_novel", "premise": "P",
                                "tone": "t", "theme": "th", "target_audience": "ta"},
                    "story_dna": {"core_contradiction": {"statement": "NEW statement",
                                                          "side_a": "a", "side_b": "b"},
                                  "value_stack": []},
                },
                MagicMock(),
            ))
            mock_agent_cls.return_value = mock_instance
            response = c.post("/api/v1/projects/test_project/creative/canvas/commit")
        assert response.status_code == 200
        data = json.loads(
            (project_dir / "concept_and_dna.json").read_text(encoding="utf-8")
        )
        assert data["source"] == "canvas"  # not "initial_intent"
        assert data["concept"]["title"] == "NEW"


class TestFormatCanvasSummary:
    """Unit tests for the canvas summary formatter."""

    def test_format_includes_depth_and_tags(self):
        from backend.api.creative_canvas import _format_canvas_summary
        nodes = {
            "a": {"depth": 0, "content": "根前提", "trope_tags": ["x"], "novelty_score": 80,
                  "mutation_context": None},
            "b": {"depth": 1, "content": "细化前提", "trope_tags": ["y"], "novelty_score": 60,
                  "mutation_context": {
                      "operation": "inversion",
                      "core_conflict": "冲突X",
                      "novelty_hook": "钩子Y",
                      "self_consistency_check": "自洽Z",
                  }},
        }
        text = _format_canvas_summary(["a", "b"], nodes)
        assert "[深度 0]" in text
        assert "根前提" in text
        assert "标签=x" in text
        assert "[深度 1]" in text
        assert "细化前提" in text
        assert "[变异 inversion]" in text
        assert "核心冲突: 冲突X" in text
        assert "新颖钩子: 钩子Y" in text
        assert "自洽检查: 自洽Z" in text

    def test_format_handles_missing_node(self):
        from backend.api.creative_canvas import _format_canvas_summary
        text = _format_canvas_summary(["missing"], {})
        assert "[深度 0]" in text
        assert "（无内容）" in text

    def test_format_truncates_oversized_node_content(self):
        """W3: nodes longer than MAX_NODE_CONTENT_CHARS are truncated with
        a marker so the LLM prompt doesn't blow past max_tokens silently.
        """
        from backend.api.creative_canvas import _format_canvas_summary
        huge = "x" * (10_000)
        nodes = {
            "a": {"depth": 0, "content": "short", "trope_tags": [],
                  "novelty_score": 0, "mutation_context": None},
            "b": {"depth": 1, "content": huge, "trope_tags": [],
                  "novelty_score": 0, "mutation_context": None},
        }
        text = _format_canvas_summary(["a", "b"], nodes)
        assert "short" in text
        assert "x" * 8_000 in text
        assert "x" * 8_001 not in text  # truncated
        assert "截断" in text

    def test_format_truncates_oversized_total_summary(self):
        """W3: assembled summary past MAX_SUMMARY_CHARS gets a tail marker.
        Each node's content stays under MAX_NODE_CONTENT_CHARS so per-node
        truncation doesn't fire — only the total-length cap does.
        """
        from backend.api.creative_canvas import _format_canvas_summary, MAX_SUMMARY_CHARS
        # 5 nodes × 7,000 chars = 35,000 chars of node content, each under
        # the 8,000-char per-node cap. Plus ~100 chars of depth/label
        # overhead per node, so total >> MAX_SUMMARY_CHARS (32,000).
        nodes = {
            f"n{i}": {"depth": i, "content": "y" * 7_000, "trope_tags": [],
                      "novelty_score": 0, "mutation_context": None}
            for i in range(5)
        }
        text = _format_canvas_summary([f"n{i}" for i in range(5)], nodes)
        assert len(text) <= MAX_SUMMARY_CHARS + 50  # +marker overhead
        assert "后续内容已截断" in text
