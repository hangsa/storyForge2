"""Tests for Creative Canvas API endpoints."""
import json
import tempfile
from pathlib import Path
from unittest.mock import MagicMock, AsyncMock, patch

import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def temp_dir():
    d = tempfile.mkdtemp()
    yield Path(d)
    import shutil
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def client(temp_dir):
    from backend.config import settings
    original = settings.projects_dir
    settings.projects_dir = temp_dir

    # Create test project
    project_dir = temp_dir / "test_project"
    project_dir.mkdir(parents=True)
    project_dir.joinpath("project.json").write_text(
        json.dumps({"id": "test_project", "initial_intent": {"free_text": "测试"}}),
        encoding="utf-8",
    )
    creative_os_dir = project_dir / "creative_os"
    creative_os_dir.mkdir(parents=True)
    creative_os_dir.joinpath("canvas_state.json").write_text(
        json.dumps({
            "root_node_id": "wi_001_00",
            "nodes": {
                "wi_001_00": {
                    "id": "wi_001_00", "depth": 0, "parent_id": None,
                    "content": "测试前提", "dimension": "角色动机",
                    "novelty_score": 70, "trope_tags": [], "is_expanded": False,
                    "children_ids": [],
                },
            },
            "edges": [],
            "selected_path": ["wi_001_00"],
            "created_at": "2026-06-18T00:00:00",
            "updated_at": "2026-06-18T00:00:00",
        }, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    from backend.api.creative_canvas import router
    from fastapi import FastAPI
    app = FastAPI()
    app.include_router(router)
    client = TestClient(app)

    yield client
    settings.projects_dir = original


class TestCanvasStateEndpoint:

    def test_get_state(self, client):
        response = client.get(
            "/api/v1/projects/test_project/creative/canvas/state"
        )
        assert response.status_code == 200
        data = response.json()
        assert data["error"] is False
        assert "nodes" in data["detail"]
        assert data["detail"]["root_node_id"] == "wi_001_00"

    def test_get_state_no_project(self, client):
        response = client.get(
            "/api/v1/projects/nonexistent/creative/canvas/state"
        )
        assert response.status_code == 404


class TestCanvasInitEndpoint:

    def test_init_canvas(self, client):
        with patch(
            "backend.creative_os.whatif_engine.WhatIfEngine"
        ) as mock_engine:
            mock_instance = MagicMock()
            mock_instance.generate_root.return_value = MagicMock(
                id="wi_001_00", depth=0, parent_id=None,
                content="new root",
                branch_status="active",
                novelty_score=0, trope_tags=[], is_expanded=False,
                children_ids=[], saturation_warning=None,
            )
            mock_engine.return_value = mock_instance

            response = client.post(
                "/api/v1/projects/test_project/creative/canvas/init",
                json={"premise": "测试前提"},
            )
            assert response.status_code == 200
            data = response.json()
            assert data["error"] is False
            assert data["code"] == "OK"


class TestCanvasExpandEndpoint:

    def test_expand_marks_non_chosen_children_as_dimmed(self, client, temp_dir):
        """Regression: after /expand, only children[0] should be active;
        the rest default to dimmed. Without this, the 2 unchosen children
        render as fully-active siblings of the chosen one, causing
        'expanding one node makes siblings appear to expand' UX confusion."""
        import asyncio
        from backend.api.creative_canvas import _read_canvas

        project_dir = temp_dir / "test_project"
        creative_os_dir = project_dir / "creative_os"
        creative_os_dir.mkdir(parents=True, exist_ok=True)
        creative_os_dir.joinpath("canvas_state.json").write_text(
            json.dumps({
                "schema_version": 2,
                "root_node_id": "wi_001_00",
                "nodes": {
                    "wi_001_00": {
                        "id": "wi_001_00", "depth": 0, "parent_id": None,
                        "content": "root", "novelty_score": 0,
                        "trope_tags": [], "saturation_warning": None,
                        "children_ids": [], "is_expanded": True,
                        "branch_status": "active",
                    },
                },
                "edges": [],
                "selected_path": ["wi_001_00"],
                "branch_choices": {},
                "evaluations": {},
                "created_at": "2026-06-23T00:00:00",
                "updated_at": "2026-06-23T00:00:00",
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        # Mock LLM expansion to return 3 children
        from backend.models.creative_os import WhatIfNode
        fake_children = [
            WhatIfNode(
                id=f"wi_2_{i:03d}_00", depth=2, parent_id="wi_001_00",
                content=f"child {i}", novelty_score=70, trope_tags=[],
                children_ids=[], is_expanded=False,
                branch_status="active",
            )
            for i in range(1, 4)
        ]

        class FakeEngine:
            async def expand_node(self, node, ancestor_contents=None):
                for child in fake_children:
                    node.children_ids.append(child.id)
                node.is_expanded = True
                return fake_children

        with patch(
            "backend.creative_os.whatif_engine.WhatIfEngine",
            return_value=FakeEngine(),
        ):
            # Also patch evaluator & director to avoid touching real modules
            with patch(
                "backend.creative_os.novelty_evaluator.NoveltyEvaluator"
            ) as MockEval:
                MockEval.return_value.evaluate_node.return_value = MagicMock(
                    total=70, market_saturation_score=70,
                    trope_similarity_score=70, contradiction_depth_score=70,
                    discussion_potential_score=70, grade="B",
                )
                with patch(
                    "backend.agents.creative_director.CreativeDirector"
                ) as MockDir:
                    MockDir.return_value.suggest_direction = AsyncMock(
                        return_value=""
                    )
                    response = client.post(
                        "/api/v1/projects/test_project/creative/canvas/expand",
                        json={"node_id": "wi_001_00"},
                    )

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["error"] is False

        returned_nodes = data["detail"]["nodes"]
        statuses = [n["branch_status"] for n in returned_nodes.values()]
        # First child → active; the other two → dimmed
        assert statuses.count("active") == 1, statuses
        assert statuses.count("dimmed") == 2, statuses

        # Same invariant must hold in the persisted canvas
        canvas = _read_canvas("test_project")
        persisted_statuses = [
            n["branch_status"] for n in canvas["nodes"].values()
            if n["parent_id"] == "wi_001_00"
        ]
        assert persisted_statuses.count("active") == 1
        assert persisted_statuses.count("dimmed") == 2


class TestCanvasMutateEndpoint:

    def test_mutate_returns_recommendation(self, client, temp_dir):
        """Regression: /mutate should call CreativeDirector and return a
        text recommendation (no longer the placeholder message)."""
        from backend.api.creative_canvas import _read_canvas

        # Seed a canvas with an active parent + 3 active children,
        # one of which is the chosen branch.
        creative_os_dir = temp_dir / "test_project" / "creative_os"
        creative_os_dir.mkdir(parents=True, exist_ok=True)
        creative_os_dir.joinpath("canvas_state.json").write_text(
            json.dumps({
                "schema_version": 2,
                "root_node_id": "wi_001_00",
                "nodes": {
                    "wi_001_00": {
                        "id": "wi_001_00", "depth": 0, "parent_id": None,
                        "content": "Root", "novelty_score": 0,
                        "trope_tags": [], "saturation_warning": None,
                        "children_ids": ["wi_002_00"], "is_expanded": True,
                        "branch_status": "active",
                    },
                    "wi_002_00": {
                        "id": "wi_002_00", "depth": 1, "parent_id": "wi_001_00",
                        "content": "废柴逆袭：主角觉醒血脉逆天改命",
                        "novelty_score": 50, "trope_tags": ["废柴逆袭"],
                        "saturation_warning": None, "children_ids": [],
                        "is_expanded": False, "branch_status": "active",
                    },
                },
                "edges": [],
                "selected_path": ["wi_001_00", "wi_002_00"],
                "branch_choices": {"wi_001_00": "wi_002_00"},
                "evaluations": {},
                "created_at": "2026-06-23T00:00:00",
                "updated_at": "2026-06-23T00:00:00",
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        with patch(
            "backend.agents.creative_director.CreativeDirector"
        ) as MockDir:
            MockDir.return_value.recommend_mutation = AsyncMock(
                return_value="推荐 Inversion 反转：把废柴逆袭反转为天才陨落"
            )
            response = client.post(
                "/api/v1/projects/test_project/creative/canvas/mutate",
                json={"node_id": "wi_002_00"},
            )

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["error"] is False
        assert "recommendation" in data["detail"]
        assert "反转" in data["detail"]["recommendation"]

    def test_mutate_rejects_dimmed_node(self, client, temp_dir):
        creative_os_dir = temp_dir / "test_project" / "creative_os"
        creative_os_dir.mkdir(parents=True, exist_ok=True)
        creative_os_dir.joinpath("canvas_state.json").write_text(
            json.dumps({
                "schema_version": 2,
                "root_node_id": "wi_001_00",
                "nodes": {
                    "wi_001_00": {
                        "id": "wi_001_00", "depth": 0, "parent_id": None,
                        "content": "Root", "novelty_score": 0,
                        "trope_tags": [], "saturation_warning": None,
                        "children_ids": ["wi_002_00", "wi_002_01"],
                        "is_expanded": True, "branch_status": "active",
                    },
                    "wi_002_00": {
                        "id": "wi_002_00", "depth": 1, "parent_id": "wi_001_00",
                        "content": "A active", "novelty_score": 0,
                        "trope_tags": [], "saturation_warning": None,
                        "children_ids": [], "is_expanded": False,
                        "branch_status": "active",
                    },
                    "wi_002_01": {
                        "id": "wi_002_01", "depth": 1, "parent_id": "wi_001_00",
                        "content": "B dimmed", "novelty_score": 0,
                        "trope_tags": [], "saturation_warning": None,
                        "children_ids": [], "is_expanded": False,
                        "branch_status": "dimmed",
                    },
                },
                "edges": [],
                "selected_path": ["wi_001_00", "wi_002_00"],
                "branch_choices": {"wi_001_00": "wi_002_00"},
                "evaluations": {},
                "created_at": "2026-06-23T00:00:00",
                "updated_at": "2026-06-23T00:00:00",
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        response = client.post(
            "/api/v1/projects/test_project/creative/canvas/mutate",
            json={"node_id": "wi_002_01"},
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "DIMMED_NODE_CANNOT_MUTATE"


class TestCanvasApplyMutationEndpoint:

    def test_apply_mutation_creates_sibling_node(self, client, temp_dir):
        """Apply inversion: original node becomes dimmed, new active
        sibling is added under the same parent, branch_choices updated."""
        from backend.api.creative_canvas import _read_canvas

        creative_os_dir = temp_dir / "test_project" / "creative_os"
        creative_os_dir.mkdir(parents=True, exist_ok=True)
        creative_os_dir.joinpath("canvas_state.json").write_text(
            json.dumps({
                "schema_version": 2,
                "root_node_id": "wi_001_00",
                "nodes": {
                    "wi_001_00": {
                        "id": "wi_001_00", "depth": 0, "parent_id": None,
                        "content": "Root", "novelty_score": 0,
                        "trope_tags": [], "saturation_warning": None,
                        "children_ids": ["wi_002_00"], "is_expanded": True,
                        "branch_status": "active",
                    },
                    "wi_002_00": {
                        "id": "wi_002_00", "depth": 1, "parent_id": "wi_001_00",
                        "content": "废柴逆袭", "novelty_score": 50,
                        "trope_tags": ["废柴逆袭"], "saturation_warning": None,
                        "children_ids": [], "is_expanded": False,
                        "branch_status": "active",
                    },
                },
                "edges": [],
                "selected_path": ["wi_001_00", "wi_002_00"],
                "branch_choices": {"wi_001_00": "wi_002_00"},
                "evaluations": {},
                "created_at": "2026-06-23T00:00:00",
                "updated_at": "2026-06-23T00:00:00",
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        # Mock MutationEngine to return a known MutationResult
        from backend.models.creative_os import MutationOp, MutationResult

        fake_result = MutationResult(
            operation=MutationOp.INVERSION,
            source_trope_id="synthetic_wi_002_00",
            source_trope_name="废柴逆袭",
            core_premise="天才陨落：主角从巅峰跌落，被迫以普通人身份重新崛起",
            core_conflict="能力消失后的身份落差与信任危机",
            novelty_hook="曾经的救世主成了被怀疑的对象",
            self_consistency_check="逻辑自洽：可通过封印/失忆等机制合理化能力消失",
            tokens_used=800,
        )

        class FakeEngine:
            async def mutate(self, trope, op, context=""):
                return fake_result

        with patch(
            "backend.creative_os.mutation_engine.MutationEngine",
            return_value=FakeEngine(),
        ):
            response = client.post(
                "/api/v1/projects/test_project/creative/canvas/apply-mutation",
                json={"node_id": "wi_002_00", "operation": "inversion"},
            )

        assert response.status_code == 200, response.text
        data = response.json()
        assert data["error"] is False

        new_node = data["detail"]["new_node"]
        assert new_node["parent_id"] == "wi_001_00"
        assert new_node["branch_status"] == "active"
        assert "mut:inversion" in new_node["trope_tags"]
        assert "天才陨落" in new_node["content"]

        mutation_result = data["detail"]["mutation_result"]
        assert mutation_result["operation"] == "inversion"
        assert mutation_result["core_premise"] == fake_result.core_premise

        # Persisted canvas: original dimmed, new active, branch_choice updated
        canvas = _read_canvas("test_project")
        nodes = canvas["nodes"]
        new_id = new_node["id"]

        assert nodes["wi_002_00"]["branch_status"] == "dimmed"
        assert nodes[new_id]["branch_status"] == "active"
        assert new_id in nodes["wi_001_00"]["children_ids"]
        assert canvas["branch_choices"]["wi_001_00"] == new_id
        # selected_path now points to new node
        assert canvas["selected_path"][-1] == new_id

    def test_apply_mutation_rejects_root_node(self, client, temp_dir):
        creative_os_dir = temp_dir / "test_project" / "creative_os"
        creative_os_dir.mkdir(parents=True, exist_ok=True)
        creative_os_dir.joinpath("canvas_state.json").write_text(
            json.dumps({
                "schema_version": 2,
                "root_node_id": "wi_001_00",
                "nodes": {
                    "wi_001_00": {
                        "id": "wi_001_00", "depth": 0, "parent_id": None,
                        "content": "Root", "novelty_score": 0,
                        "trope_tags": [], "saturation_warning": None,
                        "children_ids": [], "is_expanded": False,
                        "branch_status": "active",
                    },
                },
                "edges": [],
                "selected_path": ["wi_001_00"],
                "branch_choices": {},
                "evaluations": {},
                "created_at": "2026-06-23T00:00:00",
                "updated_at": "2026-06-23T00:00:00",
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        response = client.post(
            "/api/v1/projects/test_project/creative/canvas/apply-mutation",
            json={"node_id": "wi_001_00", "operation": "inversion"},
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "ROOT_CANNOT_MUTATE"

    def test_apply_mutation_rejects_invalid_op(self, client, temp_dir):
        creative_os_dir = temp_dir / "test_project" / "creative_os"
        creative_os_dir.mkdir(parents=True, exist_ok=True)
        creative_os_dir.joinpath("canvas_state.json").write_text(
            json.dumps({
                "schema_version": 2,
                "root_node_id": "wi_001_00",
                "nodes": {
                    "wi_001_00": {
                        "id": "wi_001_00", "depth": 0, "parent_id": None,
                        "content": "Root", "novelty_score": 0,
                        "trope_tags": [], "saturation_warning": None,
                        "children_ids": ["wi_002_00"], "is_expanded": True,
                        "branch_status": "active",
                    },
                    "wi_002_00": {
                        "id": "wi_002_00", "depth": 1, "parent_id": "wi_001_00",
                        "content": "A", "novelty_score": 0,
                        "trope_tags": [], "saturation_warning": None,
                        "children_ids": [], "is_expanded": False,
                        "branch_status": "active",
                    },
                },
                "edges": [],
                "selected_path": ["wi_001_00", "wi_002_00"],
                "branch_choices": {"wi_001_00": "wi_002_00"},
                "evaluations": {},
                "created_at": "2026-06-23T00:00:00",
                "updated_at": "2026-06-23T00:00:00",
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        response = client.post(
            "/api/v1/projects/test_project/creative/canvas/apply-mutation",
            json={"node_id": "wi_002_00", "operation": "bogus_op"},
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "INVALID_OPERATION"

    def test_apply_mutation_rejects_fusion(self, client, temp_dir):
        """Fusion requires two nodes — should be rejected with a hint to
        use /merge instead."""
        creative_os_dir = temp_dir / "test_project" / "creative_os"
        creative_os_dir.mkdir(parents=True, exist_ok=True)
        creative_os_dir.joinpath("canvas_state.json").write_text(
            json.dumps({
                "schema_version": 2,
                "root_node_id": "wi_001_00",
                "nodes": {
                    "wi_001_00": {
                        "id": "wi_001_00", "depth": 0, "parent_id": None,
                        "content": "Root", "novelty_score": 0,
                        "trope_tags": [], "saturation_warning": None,
                        "children_ids": ["wi_002_00"], "is_expanded": True,
                        "branch_status": "active",
                    },
                    "wi_002_00": {
                        "id": "wi_002_00", "depth": 1, "parent_id": "wi_001_00",
                        "content": "A", "novelty_score": 0,
                        "trope_tags": [], "saturation_warning": None,
                        "children_ids": [], "is_expanded": False,
                        "branch_status": "active",
                    },
                },
                "edges": [],
                "selected_path": ["wi_001_00", "wi_002_00"],
                "branch_choices": {"wi_001_00": "wi_002_00"},
                "evaluations": {},
                "created_at": "2026-06-23T00:00:00",
                "updated_at": "2026-06-23T00:00:00",
            }, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

        response = client.post(
            "/api/v1/projects/test_project/creative/canvas/apply-mutation",
            json={"node_id": "wi_002_00", "operation": "fusion"},
        )
        assert response.status_code == 400
        assert response.json()["detail"]["code"] == "FUSION_NOT_SUPPORTED"
