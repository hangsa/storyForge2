import pytest
from fastapi.testclient import TestClient
from backend.main import app


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def project_data():
    return {
        "title": "测试小说",
        "genre": "cool_novel",
        "min_words": 4000,
        "free_text": "一个少年在异世界觉醒能力，踏上强者之路",
        "inspiration_source": "web_novel",
    }


class TestProjectLifecycle:

    def test_health(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json()["status"] == "ok"

    def test_create_project(self, client, project_data):
        resp = client.post("/api/project/create", json=project_data)
        assert resp.status_code == 200
        data = resp.json()
        assert data["error"] is False
        assert data["detail"]["title"] == "测试小说"
        assert data["detail"]["current_stage"] == "INIT"
        assert data["detail"]["id"].startswith("proj_")

    def test_create_project_validation(self, client):
        resp = client.post("/api/project/create", json={"title": "", "free_text": ""})
        assert resp.status_code == 400

    def test_get_project_status(self, client, project_data):
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        resp = client.get(f"/api/project/{proj_id}/status")
        assert resp.status_code == 200
        data = resp.json()
        assert data["detail"]["current_stage"] == "INIT"
        assert data["detail"]["project_id"] == proj_id

    def test_get_project_not_found(self, client):
        resp = client.get("/api/project/nonexistent/status")
        assert resp.status_code == 404


class TestConductorStageTransitions:

    def test_create_and_advance_init_to_stage1(self, client, project_data):
        # Create project
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        # Advance INIT -> STAGE1 (project.json exists, title + genre non-empty)
        resp = client.post("/api/conductor/advance", json={
            "project_id": proj_id,
            "target_stage": "STAGE1",
        })
        assert resp.status_code == 200
        data = resp.json()
        assert data["error"] is False
        assert data["detail"]["from_stage"] == "INIT"
        assert data["detail"]["to_stage"] == "STAGE1"

        # Verify stage updated
        status_resp = client.get(f"/api/project/{proj_id}/status")
        assert status_resp.json()["detail"]["current_stage"] == "STAGE1"

    def test_advance_missing_files(self, client, project_data):
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        # Advance INIT -> STAGE1
        client.post("/api/conductor/advance", json={
            "project_id": proj_id,
            "target_stage": "STAGE1",
        })

        # Try to advance STAGE1 -> STAGE2 without concept_and_dna.json
        resp = client.post("/api/conductor/advance", json={
            "project_id": proj_id,
            "target_stage": "STAGE2",
        })
        assert resp.status_code == 400
        data = resp.json()["detail"]
        assert data["code"] == "STAGE_NOT_READY"
        assert "concept_and_dna.json" in data["detail"]["missing_files"]

    def test_advance_skip_stage_rejected(self, client, project_data):
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        resp = client.post("/api/conductor/advance", json={
            "project_id": proj_id,
            "target_stage": "STAGE3",
        })
        assert resp.status_code == 400
        assert "无效的阶段转换" in resp.json()["detail"]["message"]

    def test_full_stage_progression(self, client, project_data):
        # Create and advance through all stages
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        # INIT -> STAGE1
        resp = client.post("/api/conductor/advance", json={
            "project_id": proj_id, "target_stage": "STAGE1",
        })
        assert resp.status_code == 200

        # Create concept_and_dna.json, then STAGE1 -> STAGE2
        import os, json
        proj_dir = f"projects/{proj_id}"
        os.makedirs(proj_dir, exist_ok=True)
        with open(f"{proj_dir}/concept_and_dna.json", "w") as f:
            json.dump({
                "concept": {"title": "测试", "premise": "test", "tone": "", "theme": ""},
                "story_dna": {"core_contradiction": {"statement": "力量与责任的矛盾", "side_a": "", "side_b": ""}},
            }, f, ensure_ascii=False)

        resp = client.post("/api/conductor/advance", json={
            "project_id": proj_id, "target_stage": "STAGE2",
        })
        assert resp.status_code == 200

        # Create world.json + characters.json, then STAGE2 -> STAGE3
        with open(f"{proj_dir}/world.json", "w") as f:
            json.dump({"era": "异世界", "power_system": {"name": "灵力", "ceilings": []}}, f, ensure_ascii=False)
        with open(f"{proj_dir}/characters.json", "w") as f:
            json.dump({"characters": [{"id": "c1", "name": "主角"}]}, f, ensure_ascii=False)

        resp = client.post("/api/conductor/advance", json={
            "project_id": proj_id, "target_stage": "STAGE3",
        })
        assert resp.status_code == 200

        # Create outline.json, then STAGE3 -> STAGE4
        with open(f"{proj_dir}/outline.json", "w") as f:
            json.dump({"chapters": [{"chapter_number": 1, "title": "第一章", "scene_plan": [{"scene_number": 1}]}]}, f, ensure_ascii=False)

        resp = client.post("/api/conductor/advance", json={
            "project_id": proj_id, "target_stage": "STAGE4",
        })
        assert resp.status_code == 200

        # Create progress.json, then STAGE4 -> COMPLETED
        with open(f"{proj_dir}/progress.json", "w") as f:
            json.dump({"chapters": [{"chapter_number": 1, "scenes": [{"scene_number": 1, "status": "completed"}]}]}, f, ensure_ascii=False)

        resp = client.post("/api/conductor/advance", json={
            "project_id": proj_id, "target_stage": "COMPLETED",
        })
        assert resp.status_code == 200

        # Verify final stage
        status_resp = client.get(f"/api/project/{proj_id}/status")
        assert status_resp.json()["detail"]["current_stage"] == "COMPLETED"


class TestStage1:

    def test_generate_concept_wrong_stage(self, client, project_data):
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        # Still in INIT, shouldn't allow STAGE1 generate
        resp = client.post("/api/stage1/generate", json={"project_id": proj_id})
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "STAGE_NOT_READY"

    def test_update_concept(self, client, project_data):
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        resp = client.put("/api/stage1/concept", json={
            "project_id": proj_id,
            "concept": {"title": "自定义概念"},
            "story_dna": {"core_contradiction": {"statement": "test"}},
        })
        assert resp.status_code == 200


class TestStage4:

    def test_write_scene_wrong_stage(self, client, project_data):
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        resp = client.post("/api/stage4/write-scene", json={
            "project_id": proj_id,
            "scene_number": 1,
        })
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "STAGE_NOT_READY"

    def test_get_scene_plan_not_found(self, client, project_data):
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        resp = client.get(f"/api/stage4/scene-plan/1?project_id={proj_id}")
        assert resp.status_code == 404

    def test_skip_scene(self, client, project_data):
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        resp = client.post("/api/stage4/skip-scene", json={
            "project_id": proj_id,
            "scene_number": 1,
        })
        assert resp.status_code == 200
        assert "已跳过" in resp.json()["message"]

    def test_force_pass(self, client, project_data):
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        # Need progress.json first
        import os, json
        proj_dir = f"projects/{proj_id}"
        os.makedirs(proj_dir, exist_ok=True)
        with open(f"{proj_dir}/progress.json", "w") as f:
            json.dump({"project_id": proj_id, "chapters": [{"scenes": [{"scene_number": 1, "status": "pending"}]}]}, f, ensure_ascii=False)

        resp = client.post("/api/stage4/force-pass", json={
            "project_id": proj_id,
            "scene_number": 1,
        })
        assert resp.status_code == 200

    def test_get_progress(self, client, project_data):
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        resp = client.get(f"/api/stage4/progress?project_id={proj_id}")
        assert resp.status_code == 200


class TestStoryOS:

    def test_get_registry(self, client, project_data):
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        resp = client.get(f"/api/storyos/conflicts?project_id={proj_id}")
        assert resp.status_code == 200
        assert resp.json()["detail"]["count"] == 0

    def test_get_registry_invalid_type(self, client, project_data):
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        resp = client.get(f"/api/storyos/invalid?project_id={proj_id}")
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "INVALID_TYPE"
