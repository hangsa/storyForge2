"""Tests for POST /api/project/bulk-delete."""
import json
import shutil
import tempfile
from pathlib import Path
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def temp_projects_dir():
    d = Path(tempfile.mkdtemp())
    yield d
    shutil.rmtree(d, ignore_errors=True)


@pytest.fixture
def client(temp_projects_dir):
    from backend.config import settings
    original = settings.projects_dir
    settings.projects_dir = temp_projects_dir

    from backend.api.project import router as project_router
    app = FastAPI()
    app.include_router(project_router)
    yield TestClient(app)
    settings.projects_dir = original


def _make_project(root: Path, pid: str, title: str = "测试") -> Path:
    pdir = root / pid
    pdir.mkdir(parents=True)
    (pdir / "project.json").write_text(
        json.dumps({"id": pid, "title": title}, ensure_ascii=False),
        encoding="utf-8",
    )
    return pdir


class TestBulkDelete:

    def test_all_ids_exist_returns_deleted(self, client, temp_projects_dir):
        _make_project(temp_projects_dir, "proj_a", "A")
        _make_project(temp_projects_dir, "proj_b", "B")
        _make_project(temp_projects_dir, "proj_c", "C")

        resp = client.post("/api/project/bulk-delete", json={"project_ids": ["proj_a", "proj_b"]})

        assert resp.status_code == 200
        body = resp.json()
        assert body["error"] is False
        assert body["detail"]["deleted"] == ["proj_a", "proj_b"]
        assert body["detail"]["failed"] == []
        assert body["detail"]["deleted_count"] == 2
        assert body["detail"]["failed_count"] == 0
        assert not (temp_projects_dir / "proj_a").exists()
        assert not (temp_projects_dir / "proj_b").exists()
        assert (temp_projects_dir / "proj_c").exists()

    def test_mixed_existing_and_missing(self, client, temp_projects_dir):
        _make_project(temp_projects_dir, "proj_a", "A")

        resp = client.post(
            "/api/project/bulk-delete",
            json={"project_ids": ["proj_a", "proj_missing"]},
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["detail"]["deleted"] == ["proj_a"]
        assert body["detail"]["failed"] == [{"id": "proj_missing", "error": "not_found"}]

    def test_all_missing_returns_failed_only(self, client, temp_projects_dir):
        resp = client.post(
            "/api/project/bulk-delete",
            json={"project_ids": ["proj_x", "proj_y"]},
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["detail"]["deleted"] == []
        assert {f["id"] for f in body["detail"]["failed"]} == {"proj_x", "proj_y"}
        assert all(f["error"] == "not_found" for f in body["detail"]["failed"])

    def test_empty_list_returns_400(self, client):
        resp = client.post("/api/project/bulk-delete", json={"project_ids": []})
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"

    def test_missing_project_ids_field_returns_400(self, client):
        resp = client.post("/api/project/bulk-delete", json={})
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"

    def test_project_ids_not_a_list_returns_400(self, client):
        resp = client.post("/api/project/bulk-delete", json={"project_ids": "proj_a"})
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"

    def test_non_string_item_marked_invalid_id(self, client, temp_projects_dir):
        _make_project(temp_projects_dir, "proj_a", "A")

        resp = client.post(
            "/api/project/bulk-delete",
            json={"project_ids": ["proj_a", 42, None]},
        )

        assert resp.status_code == 200
        body = resp.json()
        assert body["detail"]["deleted"] == ["proj_a"]
        failed_by_id = {f["id"]: f["error"] for f in body["detail"]["failed"]}
        assert failed_by_id == {"42": "invalid_id", "None": "invalid_id"}

    def test_unexpected_exception_in_delete_marked_failed(self, client, temp_projects_dir):
        _make_project(temp_projects_dir, "proj_a", "A")
        _make_project(temp_projects_dir, "proj_b", "B")

        from backend.api.project import FileManager
        original_delete = FileManager.delete_project

        def boom(self, pid):
            if pid == "proj_a":
                raise OSError("disk full")
            return original_delete(self, pid)

        with patch.object(FileManager, "delete_project", autospec=True, side_effect=boom):
            resp = client.post(
                "/api/project/bulk-delete",
                json={"project_ids": ["proj_a", "proj_b"]},
            )

        assert resp.status_code == 200
        body = resp.json()
        assert body["detail"]["deleted"] == ["proj_b"]
        assert body["detail"]["failed"] == [
            {"id": "proj_a", "error": "disk full"}
        ]
