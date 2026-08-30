import json
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from backend.config import settings
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
    }


def _write_project_json(projects_dir: Path, proj_id: str, filename: str, data: dict) -> None:
    """Write an arbitrary JSON file into a project directory.

    `TestClient` writes to `settings.projects_dir`; this helper reaches in
    to seed `novel_outline.json` / `outline.json` for the fallback tests.
    """
    p = Path(projects_dir) / proj_id
    p.mkdir(parents=True, exist_ok=True)
    (p / filename).write_text(json.dumps(data, ensure_ascii=False), encoding="utf-8")


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
        resp = client.post("/api/project/create", json={"title": ""})
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"
        assert resp.json()["detail"]["message"] == "项目名称必填"

    def test_create_project_missing_title(self, client):
        resp = client.post("/api/project/create", json={"genre": "cool_novel"})
        assert resp.status_code == 400
        assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"

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

        # Create world.json + characters.json + novel_outline.json, then STAGE2 -> STAGE3
        with open(f"{proj_dir}/world.json", "w") as f:
            json.dump({"era": "异世界", "power_system": {"name": "灵力", "ceilings": []}}, f, ensure_ascii=False)
        with open(f"{proj_dir}/characters.json", "w") as f:
            json.dump({"characters": [{"id": "c1", "name": "主角"}]}, f, ensure_ascii=False)
        with open(f"{proj_dir}/novel_outline.json", "w") as f:
            json.dump({
                "core_conflict_theme": "测试冲突",
                "volumes": [{"name": "第一卷", "chapter_range": "1-50", "summary": "x", "key_events": []}],
            }, f, ensure_ascii=False)

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

        # Create progress.json, then STAGE4 -> STAGE5
        with open(f"{proj_dir}/progress.json", "w") as f:
            json.dump({"chapters": [{"chapter_number": 1, "scenes": [{"scene_number": 1, "status": "completed"}]}]}, f, ensure_ascii=False)

        resp = client.post("/api/conductor/advance", json={
            "project_id": proj_id, "target_stage": "STAGE5",
        })
        assert resp.status_code == 200

        # Create diagnosis_report.json, then STAGE5 -> STAGE6
        with open(f"{proj_dir}/diagnosis_report.json", "w") as f:
            json.dump({"issues": []}, f, ensure_ascii=False)

        resp = client.post("/api/conductor/advance", json={
            "project_id": proj_id, "target_stage": "STAGE6",
        })
        assert resp.status_code == 200

        # Create exports/novel.md, then STAGE6 -> COMPLETED
        export_dir = os.path.join(proj_dir, "exports")
        os.makedirs(export_dir, exist_ok=True)
        with open(f"{export_dir}/novel.md", "w") as f:
            f.write("# Test Novel")

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

    def test_get_progress_falls_back_to_novel_outline_total(self, client, project_data):
        """When progress.json is missing but novel_outline.json has 3 volumes
        spanning 1-150, /progress must return total_chapters=150 (the user's
        plan), not 1 (which is len(outline.json) for a project that hasn't
        filled in chapter 1's detailed outline yet)."""
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        # Seed novel_outline.json with 3 volumes, no progress.json, no outline.json.
        _write_project_json(settings.projects_dir, proj_id, "novel_outline.json", {
            "volumes": [
                {"name": "第一卷", "chapter_range": "1-50", "summary": "v1"},
                {"name": "第二卷", "chapter_range": "51-100", "summary": "v2"},
                {"name": "第三卷", "chapter_range": "101-150", "summary": "v3"},
            ]
        })

        resp = client.get(f"/api/stage4/progress?project_id={proj_id}")
        assert resp.status_code == 200
        detail = resp.json()["detail"]
        assert detail["total_chapters"] == 150, (
            f"expected total=150 from novel_outline.json fallback, got {detail.get('total_chapters')}"
        )
        assert detail["chapters"] == []  # no actual writing yet

    def test_get_progress_novel_outline_takes_precedence_over_outline(self, client, project_data):
        """When both novel_outline.json (3 volumes, 150ch) and outline.json
        (1 chapter detailed outline) exist but progress.json is missing,
        novel_outline's 150 wins (it's the user's planned total; outline.json
        is just the detailed scene plan for chapter 1)."""
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        _write_project_json(settings.projects_dir, proj_id, "novel_outline.json", {
            "volumes": [{"name": "v1", "chapter_range": "1-150", "summary": "v1"}]
        })
        _write_project_json(settings.projects_dir, proj_id, "outline.json", {
            "chapters": [{"chapter_number": 1, "title": "第一章", "scene_plan": []}]
        })

        resp = client.get(f"/api/stage4/progress?project_id={proj_id}")
        assert resp.status_code == 200
        assert resp.json()["detail"]["total_chapters"] == 150  # novel_outline, not outline

    def test_get_progress_uses_progress_total_chapters_when_set(self, client, project_data):
        """When progress.json exists with its own total_chapters (writing in
        progress), that value wins over the novel_outline.json fallback.
        Locks in the priority chain: progress > novel_outline > outline > 1."""
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        # progress.json says "5 chapters total, 2 done" (the writing plan).
        # novel_outline.json says "150 chapters planned". progress wins.
        _write_project_json(settings.projects_dir, proj_id, "progress.json", {
            "current_chapter": 2,
            "total_chapters": 5,
            "chapters": [
                {"chapter_number": 1, "status": "completed"},
                {"chapter_number": 2, "status": "in_progress"},
            ],
        })
        _write_project_json(settings.projects_dir, proj_id, "novel_outline.json", {
            "volumes": [{"name": "v1", "chapter_range": "1-150", "summary": "v1"}]
        })

        resp = client.get(f"/api/stage4/progress?project_id={proj_id}")
        assert resp.status_code == 200
        detail = resp.json()["detail"]
        assert detail["total_chapters"] == 5  # progress.json, not novel_outline

    def test_get_progress_malformed_chapter_range_falls_back(self, client, project_data):
        """Malformed `chapter_range` strings must not produce a misleading total."""
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]
        _write_project_json(settings.projects_dir, proj_id, "novel_outline.json", {
            "volumes": [
                {"name": "v1", "chapter_range": "-50", "summary": "missing start"},
                {"name": "v2", "chapter_range": "50-1", "summary": "inverted"},
                {"name": "v3", "chapter_range": "abc", "summary": "non-numeric"},
                {"name": "v4", "chapter_range": "1--50", "summary": "double dash"},
            ]
        })
        _write_project_json(settings.projects_dir, proj_id, "outline.json", {
            "chapters": [{"chapter_number": 1, "title": "第一章", "scene_plan": []}]
        })
        resp = client.get(f"/api/stage4/progress?project_id={proj_id}")
        assert resp.status_code == 200
        assert resp.json()["detail"]["total_chapters"] == 1

    def test_get_progress_partial_malformed_uses_valid_max(self, client, project_data):
        """When some volumes are valid and others malformed, only valid ranges count."""
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]
        _write_project_json(settings.projects_dir, proj_id, "novel_outline.json", {
            "volumes": [
                {"name": "v1", "chapter_range": "1-50", "summary": "v1"},
                {"name": "v2", "chapter_range": "garbage", "summary": "skip me"},
                {"name": "v3", "chapter_range": "101-150", "summary": "v3"},
            ]
        })
        resp = client.get(f"/api/stage4/progress?project_id={proj_id}")
        assert resp.status_code == 200
        assert resp.json()["detail"]["total_chapters"] == 150

    def test_get_progress_legacy_progress_no_total_chapters(self, client, project_data):
        """Older progress.json without total_chapters must fall through to novel_outline."""
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]
        _write_project_json(settings.projects_dir, proj_id, "progress.json", {
            "current_chapter": 1,
            "chapters": [{"chapter_number": 1, "status": "completed"}],
        })
        _write_project_json(settings.projects_dir, proj_id, "novel_outline.json", {
            "volumes": [{"name": "v1", "chapter_range": "1-200", "summary": "v1"}]
        })
        resp = client.get(f"/api/stage4/progress?project_id={proj_id}")
        assert resp.status_code == 200
        assert resp.json()["detail"]["total_chapters"] == 200

    def test_get_progress_volume_missing_chapter_range_field(self, client, project_data):
        """A volume without `chapter_range` key must be skipped gracefully."""
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]
        _write_project_json(settings.projects_dir, proj_id, "novel_outline.json", {
            "volumes": [
                {"name": "v1", "summary": "no range yet"},
                {"name": "v2", "chapter_range": "1-75", "summary": "ok"},
            ]
        })
        resp = client.get(f"/api/stage4/progress?project_id={proj_id}")
        assert resp.status_code == 200
        assert resp.json()["detail"]["total_chapters"] == 75


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


class TestMultiChapterE2E:
    """Full project lifecycle: create → advance through all stages → diagnose → export → download."""

    def _write_json(self, path_str: str, data: dict):
        import os
        os.makedirs(os.path.dirname(path_str), exist_ok=True)
        import json
        with open(path_str, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False)

    def test_full_lifecycle_3_chapters(self, client, project_data):
        """E2E: create project, advance INIT→COMPLETED with 3 chapters, diagnose, export, download."""
        # ── INIT: Create project ──
        create_resp = client.post("/api/project/create", json=project_data)
        assert create_resp.status_code == 200
        proj_id = create_resp.json()["detail"]["id"]

        # ── INIT → STAGE1 ──
        resp = client.post("/api/conductor/advance", json={
            "project_id": proj_id, "target_stage": "STAGE1",
        })
        assert resp.status_code == 200

        # ── STAGE1 → STAGE2: Provide concept ──
        proj_dir = f"projects/{proj_id}"
        self._write_json(f"{proj_dir}/concept_and_dna.json", {
            "concept": {"title": "测试小说", "genre": "cool_novel", "premise": "测试", "tone": "dark"},
            "story_dna": {"core_contradiction": {"statement": "力量与责任的矛盾", "side_a": "力量", "side_b": "责任"}},
        })
        resp = client.post("/api/conductor/advance", json={
            "project_id": proj_id, "target_stage": "STAGE2",
        })
        assert resp.status_code == 200

        # ── STAGE2 → STAGE3: Provide characters + world (novel_outline is
        # generated inside STAGE3, not a precondition for entering it) ──
        self._write_json(f"{proj_dir}/characters.json", {
            "characters": [
                {"id": "char_001", "name": "林峰", "character_type": "protagonist"},
                {"id": "char_002", "name": "苏晓晓", "character_type": "supporting"},
            ],
        })
        self._write_json(f"{proj_dir}/world.json", {
            "era": "近未来", "geography": "废土城市",
            "power_system": {"name": "灵力", "ceilings": ["第九境"], "core_rules": []},
        })
        resp = client.post("/api/conductor/advance", json={
            "project_id": proj_id, "target_stage": "STAGE3",
        })
        assert resp.status_code == 200

        # ── STAGE3 → STAGE4: Provide outline ──
        self._write_json(f"{proj_dir}/outline.json", {
            "chapters": [
                {"chapter_number": 1, "title": "觉醒", "scene_plan": [
                    {"scene_number": 1, "narrative_role": "setup"},
                    {"scene_number": 2, "narrative_role": "mini_payoff"},
                ]},
                {"chapter_number": 2, "title": "试炼", "scene_plan": [
                    {"scene_number": 3, "narrative_role": "cliffhanger"},
                ]},
                {"chapter_number": 3, "title": "决战", "scene_plan": [
                    {"scene_number": 4, "narrative_role": "major_reveal"},
                ]},
            ],
        })
        resp = client.post("/api/conductor/advance", json={
            "project_id": proj_id, "target_stage": "STAGE4",
        })
        assert resp.status_code == 200

        # ── Simulate writing: Create scene drafts for 3 chapters ──
        import os
        os.makedirs(f"{proj_dir}/chapters", exist_ok=True)

        # Chapter 1 — Scene 1
        with open(f"{proj_dir}/chapters/scene_001_draft.md", "w", encoding="utf-8") as f:
            f.write('林峰站在废墟上。冷风吹过。\n<!-- SF_LOG character_emotion char="林峰" emotion="愤怒" -->\n')
        # Chapter 1 — Scene 2
        with open(f"{proj_dir}/chapters/scene_002_draft.md", "w", encoding="utf-8") as f:
            f.write('他握紧拳头，走向前方。\n<!-- SF_LOG character_location_change char="林峰" from="废墟" to="工厂" -->\n')
        # Chapter 2 — Scene 3
        with open(f"{proj_dir}/chapters/scene_003_draft.md", "w", encoding="utf-8") as f:
            f.write('工厂内黑影闪动。\n<!-- SF_LOG conflict_escalate id="cf_001" new_intensity="high" -->\n')
        # Chapter 3 — Scene 4
        with open(f"{proj_dir}/chapters/scene_004_draft.md", "w", encoding="utf-8") as f:
            f.write('最终决战开始。\n<!-- SF_LOG mystery_clue id="mys_001" clue="真相" -->\n')

        # ── STAGE4 → STAGE5: Provide completed progress ──
        self._write_json(f"{proj_dir}/progress.json", {
            "project_id": proj_id,
            "current_chapter": 3,
            "total_chapters": 3,
            "chapters": [
                {"chapter_number": 1, "status": "completed", "scenes": [
                    {"scene_number": 1, "status": "completed", "coherence_score": 85},
                    {"scene_number": 2, "status": "completed", "coherence_score": 88},
                ]},
                {"chapter_number": 2, "status": "completed", "scenes": [
                    {"scene_number": 3, "status": "completed", "coherence_score": 90},
                ]},
                {"chapter_number": 3, "status": "completed", "scenes": [
                    {"scene_number": 4, "status": "completed", "coherence_score": 92},
                ]},
            ],
            "circuit_breaker_events": [],
        })
        resp = client.post("/api/conductor/advance", json={
            "project_id": proj_id, "target_stage": "STAGE5",
        })
        assert resp.status_code == 200

        # ── STAGE5: Run diagnosis ──
        diag_resp = client.post("/api/stage5/diagnose", json={"project_id": proj_id})
        assert diag_resp.status_code == 200
        diag_data = diag_resp.json()
        assert diag_data["error"] is False

        # ── STAGE5 → STAGE6: Provide diagnosis report with P0 resolved ──
        self._write_json(f"{proj_dir}/diagnosis_report.json", {
            "project_id": proj_id,
            "total_chapters": 3,
            "issues": [],
            "summary": {"p0_count": 0, "p1_count": 0, "p2_count": 0},
        })
        resp = client.post("/api/conductor/advance", json={
            "project_id": proj_id, "target_stage": "STAGE6",
        })
        assert resp.status_code == 200

        # ── STAGE6: Export ──
        export_resp = client.post("/api/stage6/export", json={
            "project_id": proj_id,
            "options": {"strip_sf_logs": True, "add_toc": True, "include_title_page": True},
        })
        assert export_resp.status_code == 200
        export_data = export_resp.json()
        assert export_data["error"] is False
        detail = export_data["detail"]
        assert detail["total_chars"] > 0
        from datetime import date
        import re
        safe_title = re.sub(r"[^\w一-鿿\-]", "_", "测试小说").strip("_") or "novel"
        today = date.today().strftime("%Y%m%d")
        assert detail["file_path"] == f"projects/{proj_id}/exports/{safe_title}_{today}.md"

        # SF_LOG should be stripped from export
        assert "SF_LOG" not in detail["preview"]

        # ── Download ──
        download_resp = client.get(f"/api/stage6/download?project_id={proj_id}")
        assert download_resp.status_code == 200
        assert "text/markdown" in download_resp.headers["content-type"]

        # ── STAGE6 → COMPLETED ──
        resp = client.post("/api/conductor/advance", json={
            "project_id": proj_id, "target_stage": "COMPLETED",
        })
        assert resp.status_code == 200

        # ── Verify final stage ──
        status_resp = client.get(f"/api/project/{proj_id}/status")
        assert status_resp.status_code == 200
        assert status_resp.json()["detail"]["current_stage"] == "COMPLETED"

        # ── Style extractor still works at COMPLETED ──
        style_resp = client.post("/api/style/extract", json={
            "project_id": proj_id,
            "reference_text": "林峰站在废墟上。冷风吹过。他握紧拳头，走向前方。工厂内黑影闪动。最终决战开始。",
        })
        assert style_resp.status_code == 200
        style_data = style_resp.json()
        assert style_data["error"] is False
        assert style_data["detail"]["sentence"]["avg_length"] > 0


class TestStageBackwardNavigation:
    """REGRESSION: once a project has advanced past a stage, the user must still
    be able to operate on that stage (re-edit, regenerate, etc.) from the UI.
    Old `current != Stage.N` check returned 400 STAGE_NOT_READY for any
    backward navigation. New rule: only block when current < target.
    """

    def _advance_to(self, client, proj_id, target_stage, proj_dir):
        """Use the conductor API to advance a project to a specific stage."""
        resp = client.post("/api/conductor/advance", json={
            "project_id": proj_id, "target_stage": target_stage,
        })
        assert resp.status_code == 200, f"Failed to advance to {target_stage}: {resp.text}"

    def _seed(self, proj_id):
        """Create prerequisite files so the project can advance through all gates."""
        import os, json
        proj_dir = f"projects/{proj_id}"
        os.makedirs(proj_dir, exist_ok=True)
        with open(f"{proj_dir}/concept_and_dna.json", "w") as f:
            json.dump({
                "concept": {"title": "测试", "premise": "test", "tone": "", "theme": ""},
                "story_dna": {"core_contradiction": {"statement": "力量与责任的矛盾", "side_a": "", "side_b": ""}},
            }, f, ensure_ascii=False)
        with open(f"{proj_dir}/world.json", "w") as f:
            json.dump({"era": "异世界", "power_system": {"name": "灵力", "ceilings": []}}, f, ensure_ascii=False)
        with open(f"{proj_dir}/characters.json", "w") as f:
            json.dump({"characters": [{"id": "c1", "name": "主角"}]}, f, ensure_ascii=False)
        with open(f"{proj_dir}/novel_outline.json", "w") as f:
            json.dump({
                "core_conflict_theme": "测试冲突",
                "volumes": [{"name": "v1", "chapter_range": "1-50", "summary": "x", "key_events": []}],
            }, f, ensure_ascii=False)
        with open(f"{proj_dir}/outline.json", "w") as f:
            json.dump({"chapters": [{"chapter_number": 1, "title": "第一章", "scene_plan": [{"scene_number": 1}]}]}, f, ensure_ascii=False)
        with open(f"{proj_dir}/progress.json", "w") as f:
            json.dump({"chapters": [{"chapter_number": 1, "scenes": [{"scene_number": 1, "status": "completed"}]}]}, f, ensure_ascii=False)
        return proj_dir

    def test_stage1_allowed_at_stage4(self, client, project_data):
        """Once advanced to STAGE4, re-editing concept (stage1) should be allowed."""
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]
        self._seed(proj_id)
        self._advance_to(client, proj_id, "STAGE1", None)
        self._advance_to(client, proj_id, "STAGE2", None)
        self._advance_to(client, proj_id, "STAGE3", None)
        self._advance_to(client, proj_id, "STAGE4", None)

        # Old behavior: 400 STAGE_NOT_READY. New behavior: should pass the
        # stage gate (may still fail with VALIDATION_ERROR or LLM error, but
        # NOT with STAGE_NOT_READY).
        resp = client.post("/api/stage1/generate", json={"project_id": proj_id})
        assert resp.status_code != 400 or resp.json()["detail"].get("code") != "STAGE_NOT_READY", (
            f"STAGE1 operations should be allowed when project is at STAGE4, "
            f"got: {resp.json()}"
        )

    def test_stage4_write_scene_allowed_at_stage5(self, client, project_data):
        """Once advanced to STAGE5, re-writing a scene in stage4 should be allowed."""
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]
        self._seed(proj_id)
        self._advance_to(client, proj_id, "STAGE1", None)
        self._advance_to(client, proj_id, "STAGE2", None)
        self._advance_to(client, proj_id, "STAGE3", None)
        self._advance_to(client, proj_id, "STAGE4", None)
        self._advance_to(client, proj_id, "STAGE5", None)

        # Old behavior: 400 STAGE_NOT_READY. Now allowed: the endpoint should
        # reach the precondition check (and likely fail there with a different
        # code such as SCENE_NOT_FOUND, because the seeded outline is minimal).
        resp = client.post("/api/stage4/write-scene", json={
            "project_id": proj_id,
            "chapter_number": 1,
            "scene_number": 1,
        })
        body = resp.json().get("detail", {})
        assert body.get("code") != "STAGE_NOT_READY", (
            f"STAGE4 write-scene should be allowed at STAGE5, got: {resp.json()}"
        )

    def test_init_blocks_all_stage_operations(self, client, project_data):
        """The pre-condition (project must have advanced AT LEAST to that stage)
        must still hold. INIT -> STAGE1/2/3/4/6 all blocked."""
        create_resp = client.post("/api/project/create", json=project_data)
        proj_id = create_resp.json()["detail"]["id"]

        for endpoint, payload in [
            ("/api/stage1/generate", {"project_id": proj_id}),
            ("/api/stage2/generate-world", {"project_id": proj_id}),
            ("/api/stage3/generate", {"project_id": proj_id}),
            ("/api/stage4/write-scene", {"project_id": proj_id, "chapter_number": 1, "scene_number": 1}),
            ("/api/stage6/export", {"project_id": proj_id, "options": {}}),
        ]:
            resp = client.post(endpoint, json=payload)
            assert resp.status_code == 400, f"{endpoint} should block at INIT"
            assert resp.json()["detail"]["code"] == "STAGE_NOT_READY", (
                f"{endpoint} expected STAGE_NOT_READY at INIT, got: {resp.json()}"
            )
