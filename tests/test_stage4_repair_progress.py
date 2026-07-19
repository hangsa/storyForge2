"""POST /api/stage4/repair-progress — scan progress.json for chapters
stuck in `in_progress` despite all outline scenes being terminal, and
set them to `completed`. No LLM, no L2 update, no checkpoint. Pure
state-machine repair; idempotent."""
from __future__ import annotations
import json
from pathlib import Path
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient


@pytest.fixture
def projects_dir(tmp_path: Path, monkeypatch):
    monkeypatch.setattr("backend.config.settings.projects_dir", tmp_path)
    from backend.api.stage4_writing import fm
    fm.projects_dir = tmp_path
    return tmp_path


@pytest.fixture
def client(projects_dir):
    from backend.api.stage4_writing import router
    app = FastAPI()
    app.include_router(router)
    return TestClient(app)


def _seed(projects_dir: Path, pid: str, progress: dict | None,
          outline: dict | None) -> None:
    proj = projects_dir / pid
    proj.mkdir(parents=True, exist_ok=True)
    if outline is not None:
        (proj / "outline.json").write_text(
            json.dumps(outline), encoding="utf-8"
        )
    if progress is not None:
        (proj / "progress.json").write_text(
            json.dumps(progress), encoding="utf-8"
        )


def _outline_with_scenes(*scene_nums: int) -> dict:
    return {"chapters": [{
        "chapter_number": 1,
        "scene_plan": [{"scene_number": n} for n in scene_nums],
    }]}


def test_returns_empty_when_no_progress(client, projects_dir):
    # Project dir exists but progress.json does not
    (projects_dir / "p1").mkdir(parents=True, exist_ok=True)
    resp = client.post("/api/stage4/repair-progress", json={"project_id": "p1"})
    assert resp.status_code == 200, resp.text
    detail = resp.json()["detail"]
    assert detail == {
        "repaired_chapters": [], "current_chapter": 1, "dropped_scaffolds": 0
    }


def test_repairs_chapter_when_all_scenes_terminal(client, projects_dir):
    _seed(projects_dir, "p1",
          progress={
              "project_id": "p1", "current_stage": "STAGE4",
              "current_chapter": 1, "total_chapters": 1,
              "chapters": [{
                  "chapter_number": 1, "status": "in_progress",
                  "scenes": [
                      {"scene_number": 1, "status": "completed"},
                      {"scene_number": 2, "status": "force_passed"},
                      {"scene_number": 3, "status": "skipped"},
                  ],
              }],
              "circuit_breaker_events": [],
          },
          outline=_outline_with_scenes(1, 2, 3))
    resp = client.post("/api/stage4/repair-progress", json={"project_id": "p1"})
    assert resp.status_code == 200, resp.text
    detail = resp.json()["detail"]
    assert detail["repaired_chapters"] == [1]
    # Disk reflects the change
    on_disk = json.loads(
        (projects_dir / "p1" / "progress.json").read_text(encoding="utf-8")
    )
    assert on_disk["chapters"][0]["status"] == "completed"


def test_does_not_repair_when_a_scene_still_in_progress(client, projects_dir):
    _seed(projects_dir, "p1",
          progress={
              "project_id": "p1", "current_stage": "STAGE4",
              "current_chapter": 1, "total_chapters": 1,
              "chapters": [{
                  "chapter_number": 1, "status": "in_progress",
                  "scenes": [
                      {"scene_number": 1, "status": "completed"},
                      {"scene_number": 2, "status": "completed"},
                      {"scene_number": 3, "status": "in_progress"},
                  ],
              }],
              "circuit_breaker_events": [],
          },
          outline=_outline_with_scenes(1, 2, 3))
    resp = client.post("/api/stage4/repair-progress", json={"project_id": "p1"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["detail"]["repaired_chapters"] == []


def test_does_not_repair_when_outline_scene_missing_from_progress(
    client, projects_dir
):
    _seed(projects_dir, "p1",
          progress={
              "project_id": "p1", "current_stage": "STAGE4",
              "current_chapter": 1, "total_chapters": 1,
              "chapters": [{
                  "chapter_number": 1, "status": "in_progress",
                  "scenes": [
                      {"scene_number": 1, "status": "completed"},
                      {"scene_number": 2, "status": "completed"},
                      # scene_number=3 missing — outline says 3 scenes
                  ],
              }],
              "circuit_breaker_events": [],
          },
          outline=_outline_with_scenes(1, 2, 3))
    resp = client.post("/api/stage4/repair-progress", json={"project_id": "p1"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["detail"]["repaired_chapters"] == []


def test_does_not_repair_when_chapter_not_in_outline(client, projects_dir):
    # progress has ch99, outline only knows ch1-3 — no ground truth for ch99
    _seed(projects_dir, "p1",
          progress={
              "project_id": "p1", "current_stage": "STAGE4",
              "current_chapter": 99, "total_chapters": 99,
              "chapters": [{
                  "chapter_number": 99, "status": "in_progress",
                  "scenes": [{"scene_number": 1, "status": "completed"}],
              }],
              "circuit_breaker_events": [],
          },
          outline={"chapters": [
              {"chapter_number": 1, "scene_plan": [{"scene_number": 1}]},
              {"chapter_number": 2, "scene_plan": [{"scene_number": 1}]},
              {"chapter_number": 3, "scene_plan": [{"scene_number": 1}]},
          ]})
    resp = client.post("/api/stage4/repair-progress", json={"project_id": "p1"})
    assert resp.status_code == 200, resp.text
    assert resp.json()["detail"]["repaired_chapters"] == []


def test_current_chapter_only_advances_forward(client, projects_dir):
    # Stuck chapter is BEHIND current_chapter — must not regress
    _seed(projects_dir, "p1",
          progress={
              "project_id": "p1", "current_stage": "STAGE4",
              "current_chapter": 15, "total_chapters": 20,
              "chapters": [{
                  "chapter_number": 12, "status": "in_progress",
                  "scenes": [{"scene_number": 1, "status": "completed"}],
              }],
              "circuit_breaker_events": [],
          },
          outline={
              "chapters": [
                  {"chapter_number": n,
                   "scene_plan": [{"scene_number": 1}]}
                  for n in range(12, 21)
              ]
          })
    resp = client.post("/api/stage4/repair-progress", json={"project_id": "p1"})
    detail = resp.json()["detail"]
    assert detail["repaired_chapters"] == [12]
    assert detail["current_chapter"] == 15  # not regressed


def test_current_chapter_advances_when_repairing_current(client, projects_dir):
    _seed(projects_dir, "p1",
          progress={
              "project_id": "p1", "current_stage": "STAGE4",
              "current_chapter": 13, "total_chapters": 20,
              "chapters": [{
                  "chapter_number": 13, "status": "in_progress",
                  "scenes": [{"scene_number": 1, "status": "completed"}],
              }],
              "circuit_breaker_events": [],
          },
          outline={
              "chapters": [
                  {"chapter_number": n,
                   "scene_plan": [{"scene_number": 1}]}
                  for n in range(13, 21)
              ]
          })
    resp = client.post("/api/stage4/repair-progress", json={"project_id": "p1"})
    detail = resp.json()["detail"]
    assert detail["repaired_chapters"] == [13]
    assert detail["current_chapter"] == 14


def test_idempotent_second_call_no_op(client, projects_dir):
    _seed(projects_dir, "p1",
          progress={
              "project_id": "p1", "current_stage": "STAGE4",
              "current_chapter": 13, "total_chapters": 20,
              "chapters": [{
                  "chapter_number": 13, "status": "in_progress",
                  "scenes": [{"scene_number": 1, "status": "completed"}],
              }],
              "circuit_breaker_events": [],
          },
          outline={"chapters": [
              {"chapter_number": n, "scene_plan": [{"scene_number": 1}]}
              for n in range(13, 21)
          ]})
    r1 = client.post("/api/stage4/repair-progress", json={"project_id": "p1"})
    assert r1.json()["detail"]["repaired_chapters"] == [13]
    r2 = client.post("/api/stage4/repair-progress", json={"project_id": "p1"})
    assert r2.json()["detail"]["repaired_chapters"] == []


def test_repairs_multiple_stuck_chapters_in_one_call(client, projects_dir):
    _seed(projects_dir, "p1",
          progress={
              "project_id": "p1", "current_stage": "STAGE4",
              "current_chapter": 13, "total_chapters": 20,
              "chapters": [
                  {"chapter_number": 12, "status": "in_progress",
                   "scenes": [{"scene_number": 1, "status": "completed"}]},
                  {"chapter_number": 13, "status": "in_progress",
                   "scenes": [{"scene_number": 1, "status": "completed"}]},
              ],
              "circuit_breaker_events": [],
          },
          outline={"chapters": [
              {"chapter_number": n, "scene_plan": [{"scene_number": 1}]}
              for n in range(12, 21)
          ]})
    resp = client.post("/api/stage4/repair-progress", json={"project_id": "p1"})
    detail = resp.json()["detail"]
    # Sorted ascending
    assert detail["repaired_chapters"] == [12, 13]
    # Advances to max(current=13, max_repaired+1=14) = 14
    assert detail["current_chapter"] == 14


def test_404_for_unknown_project(client, projects_dir):
    resp = client.post("/api/stage4/repair-progress",
                       json={"project_id": "does_not_exist"})
    assert resp.status_code == 404
    assert resp.json()["detail"]["code"] == "PROJECT_NOT_FOUND"


def test_400_for_empty_project_id(client, projects_dir):
    resp = client.post("/api/stage4/repair-progress",
                       json={"project_id": ""})
    assert resp.status_code == 400
    assert resp.json()["detail"]["code"] == "VALIDATION_ERROR"


# ---------------------------------------------------------------------------
# v1.9 T2: empty-scaffold scrub + current_chapter cap + autopilot 409 guard
# ---------------------------------------------------------------------------


def _seed_autopilot_session(projects_dir: Path, pid: str,
                            state: str) -> None:
    """Seed a minimal autopilot/session.json with the given state."""
    session_dir = projects_dir / pid / "autopilot"
    session_dir.mkdir(parents=True, exist_ok=True)
    (session_dir / "session.json").write_text(
        json.dumps({
            "project_id": pid,
            "state": state,
            "config": {"scope": "all_planned", "cadence": "balanced",
                       "policy": "auto", "notify": "milestones"},
            "started_at": "2026-07-17T00:00:00Z",
            "last_heartbeat_at": "2026-07-17T00:00:00Z",
            "current_task": None,
            "queue": [],
            "history": [],
            "circuit": {"force_pass_count": 0, "last_event_at": None,
                        "threshold_warning": False},
        }),
        encoding="utf-8",
    )


def test_repair_progress_drops_empty_scaffolds_past_outline_max(
    client, projects_dir
):
    """Chapters whose chapter_number is past outline_max AND whose scenes
    list is empty are scaffolding left over from an earlier run; repair
    must drop them."""
    pid = "p1"
    _seed(projects_dir, pid,
          progress={
              "project_id": pid, "current_stage": "STAGE4",
              "current_chapter": 3, "total_chapters": 3,
              "chapters": [
                  {"chapter_number": 1, "status": "completed",
                   "scenes": [{"scene_number": 1, "status": "completed"}]},
                  # Empty scaffold past outline max — drop.
                  {"chapter_number": 4, "status": "pending", "scenes": []},
                  # Empty scaffold past outline max — drop.
                  {"chapter_number": 5, "status": "pending", "scenes": []},
              ],
              "circuit_breaker_events": [],
          },
          outline={"chapters": [
              {"chapter_number": n, "scene_plan": [{"scene_number": 1}]}
              for n in range(1, 4)
          ]})
    resp = client.post("/api/stage4/repair-progress", json={"project_id": pid})
    assert resp.status_code == 200, resp.text
    detail = resp.json()["detail"]
    assert detail["dropped_scaffolds"] == 2
    on_disk = json.loads(
        (projects_dir / pid / "progress.json").read_text(encoding="utf-8")
    )
    kept_numbers = [c["chapter_number"] for c in on_disk["chapters"]]
    assert kept_numbers == [1]
    # current_chapter (3) is within outline_max+1=4 — no cap applied
    assert detail["current_chapter"] == 3


def test_repair_progress_caps_current_chapter_at_outline_max_plus_one(
    client, projects_dir
):
    pid = "p1"
    _seed(projects_dir, pid,
          progress={
              "project_id": pid, "current_stage": "STAGE4",
              "current_chapter": 8, "total_chapters": 10,
              "chapters": [
                  {"chapter_number": 1, "status": "completed",
                   "scenes": [{"scene_number": 1, "status": "completed"}]},
              ],
              "circuit_breaker_events": [],
          },
          outline={"chapters": [
              {"chapter_number": n, "scene_plan": [{"scene_number": 1}]}
              for n in range(1, 4)
          ]})
    resp = client.post("/api/stage4/repair-progress", json={"project_id": pid})
    assert resp.status_code == 200, resp.text
    detail = resp.json()["detail"]
    # outline_max = 3 → cap = 4. Capped from 8 → 4.
    assert detail["current_chapter"] == 4
    on_disk = json.loads(
        (projects_dir / pid / "progress.json").read_text(encoding="utf-8")
    )
    assert on_disk["current_chapter"] == 4
    # No scaffolds were empty past outline max.
    assert detail["dropped_scaffolds"] == 0


def test_repair_progress_with_no_scaffolds_returns_zero_dropped(
    client, projects_dir
):
    """Regression: behavior unchanged when no empty scaffolds exist."""
    pid = "p1"
    _seed(projects_dir, pid,
          progress={
              "project_id": pid, "current_stage": "STAGE4",
              "current_chapter": 1, "total_chapters": 3,
              "chapters": [
                  {"chapter_number": 1, "status": "completed",
                   "scenes": [{"scene_number": 1, "status": "completed"}]},
                  # Chapter 2 is in_progress with scenes — NOT a scaffold.
                  {"chapter_number": 2, "status": "in_progress",
                   "scenes": [{"scene_number": 1, "status": "completed"}]},
              ],
              "circuit_breaker_events": [],
          },
          outline={"chapters": [
              {"chapter_number": n, "scene_plan": [{"scene_number": 1}]}
              for n in range(1, 4)
          ]})
    resp = client.post("/api/stage4/repair-progress", json={"project_id": pid})
    assert resp.status_code == 200, resp.text
    detail = resp.json()["detail"]
    assert detail["dropped_scaffolds"] == 0
    assert detail["repaired_chapters"] == [2]
    assert detail["current_chapter"] == 3


def test_repair_progress_returns_409_when_autopilot_running(
    client, projects_dir
):
    pid = "p1"
    _seed_autopilot_session(projects_dir, pid, state="running")
    _seed(projects_dir, pid,
          progress={
              "project_id": pid, "current_stage": "STAGE4",
              "current_chapter": 1, "total_chapters": 3,
              "chapters": [
                  {"chapter_number": 1, "status": "in_progress",
                   "scenes": [{"scene_number": 1, "status": "completed"}]},
              ],
              "circuit_breaker_events": [],
          },
          outline={"chapters": [
              {"chapter_number": n, "scene_plan": [{"scene_number": 1}]}
              for n in range(1, 4)
          ]})
    resp = client.post("/api/stage4/repair-progress", json={"project_id": pid})
    assert resp.status_code == 409, resp.text
    body = resp.json()
    assert body["detail"]["code"] == "AUTOPILOT_ACTIVE"
    assert body["detail"]["detail"]["current_state"] == "running"
    # The 409 guard must NOT mutate progress.json
    on_disk = json.loads(
        (projects_dir / pid / "progress.json").read_text(encoding="utf-8")
    )
    assert on_disk["chapters"][0]["status"] == "in_progress"
    assert on_disk["current_chapter"] == 1


def test_repair_progress_succeeds_when_autopilot_idle(
    client, projects_dir
):
    """Autopilot session present but state == idle → repair runs."""
    pid = "p1"
    _seed_autopilot_session(projects_dir, pid, state="idle")
    _seed(projects_dir, pid,
          progress={
              "project_id": pid, "current_stage": "STAGE4",
              "current_chapter": 1, "total_chapters": 3,
              "chapters": [
                  {"chapter_number": 1, "status": "in_progress",
                   "scenes": [{"scene_number": 1, "status": "completed"}]},
              ],
              "circuit_breaker_events": [],
          },
          outline={"chapters": [
              {"chapter_number": n, "scene_plan": [{"scene_number": 1}]}
              for n in range(1, 4)
          ]})
    resp = client.post("/api/stage4/repair-progress", json={"project_id": pid})
    assert resp.status_code == 200, resp.text
    assert resp.json()["detail"]["repaired_chapters"] == [1]
