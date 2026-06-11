"""
API error handling tests — error codes, 4xx/5xx responses, edge cases.
"""

import json
import tempfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.main import app
from backend.config import settings


@pytest.fixture
def client():
    with tempfile.TemporaryDirectory() as tmp:
        original = settings.projects_dir
        settings.projects_dir = Path(tmp)
        with TestClient(app) as c:
            yield c
        settings.projects_dir = original


@pytest.fixture
def project_id(client):
    resp = client.post("/api/project/create", json={
        "intent": "测试项目",
        "genre": "xianxia",
        "min_words": 4000,
    })
    data = resp.json()
    return data["detail"]["id"]


class TestProjectErrors:
    def test_create_missing_intent(self, client):
        resp = client.post("/api/project/create", json={
            "genre": "xianxia", "min_words": 4000
        })
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"

    def test_status_project_not_found(self, client):
        resp = client.get("/api/project/nonexistent/status")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "PROJECT_NOT_FOUND"


class TestConductorErrors:
    def test_advance_missing_project_id(self, client):
        resp = client.post("/api/conductor/advance", json={"project_id": ""})
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"

    def test_advance_nonexistent_project(self, client):
        resp = client.post("/api/conductor/advance", json={"project_id": "nonexistent"})
        assert resp.status_code in (400, 404)


class TestStage1Errors:
    def test_generate_missing_project_id(self, client):
        resp = client.post("/api/stage1/generate", json={"project_id": ""})
        assert resp.status_code == 400

    def test_generate_nonexistent_project(self, client):
        resp = client.post("/api/stage1/generate", json={"project_id": "nonexistent"})
        assert resp.status_code in (400, 404)


class TestStage2Errors:
    def test_generate_world_missing_project_id(self, client):
        resp = client.post("/api/stage2/generate-world", json={"project_id": ""})
        assert resp.status_code == 400

    def test_generate_character_missing_project_id(self, client):
        resp = client.post("/api/stage2/generate-character", json={"project_id": ""})
        assert resp.status_code == 400


class TestStage3Errors:
    def test_generate_outline_missing_project_id(self, client):
        resp = client.post("/api/stage3/generate", json={"project_id": ""})
        assert resp.status_code == 400


class TestStage4Errors:
    def test_write_scene_missing_project_id(self, client):
        resp = client.post("/api/stage4/write-scene", json={
            "project_id": "", "scene_number": 1
        })
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"

    def test_scene_plan_not_found(self, client, project_id):
        resp = client.get(f"/api/stage4/scene-plan/99?project_id={project_id}")
        assert resp.status_code == 404
        assert resp.json()["detail"]["code"] == "SCENE_NOT_FOUND"

    def test_write_scene_nonexistent_project(self, client):
        resp = client.post("/api/stage4/write-scene", json={
            "project_id": "nonexistent", "scene_number": 1
        })
        assert resp.status_code in (400, 404)

    def test_force_pass_missing_project_id(self, client):
        resp = client.post("/api/stage4/force-pass", json={
            "project_id": "", "scene_number": 1
        })
        assert resp.status_code in (400, 404)


class TestStoryOSErrors:
    def test_registry_nonexistent_project(self, client):
        resp = client.get("/api/storyos/conflict?project_id=nonexistent")
        assert resp.status_code == 200


class TestHealth:
    def test_health_endpoint(self, client):
        resp = client.get("/api/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}
