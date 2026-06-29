# tests/test_growth_workshop_api.py
from fastapi.testclient import TestClient
from backend.main import app
from backend.config import settings

client = TestClient(app)


def _create_project(project_id: str = "gw_test_1"):
    import json
    proj = settings.projects_dir / project_id
    (proj / "storyos").mkdir(parents=True, exist_ok=True)
    (proj / "outline.json").write_text(json.dumps({"chapters": []}))
    (proj / "characters.json").write_text(json.dumps({"characters": [
        {"id": "c1", "name": "林峰",
         "growth_curve": {"stages": [
             {"stage_number": 1, "stage_name": "低谷", "bound_chapter": 50,
              "trigger_event_type": "betrayal_experienced"}
         ]}}
    ]}))
    (proj / "storyos" / "conflicts.json").write_text(json.dumps({"conflicts": []}))
    return project_id


def test_check_returns_out_of_range_error():
    pid = _create_project()
    r = client.post(f"/api/v1/projects/{pid}/characters/c1/growth/workshop/check")
    assert r.status_code == 200
    body = r.json()
    assert body["error"] is False
    warnings = body["detail"]["warnings"]
    out_of_range = [w for w in warnings if w["rule_id"] == "out_of_range"]
    assert len(out_of_range) == 1
    assert out_of_range[0]["severity"] == "error"


def test_adjust_returns_422_on_out_of_range():
    pid = _create_project()
    r = client.put(
        f"/api/v1/projects/{pid}/characters/c1/growth/workshop/adjust",
        json={"stages": [
            {"stage_number": 1, "stage_name": "低谷", "bound_chapter": 99,
             "trigger_event_type": "betrayal_experienced"}
        ]},
    )
    assert r.status_code == 422
    body = r.json()
    assert body.get("error") is True or "warnings" in str(body)


def test_adjust_succeeds_with_valid_stages():
    pid = _create_project("gw_test_2")
    import json
    proj = settings.projects_dir / pid
    (proj / "characters.json").write_text(json.dumps({"characters": [
        {"id": "c1", "name": "林峰", "growth_curve": {"stages": []}}
    ]}))
    r = client.put(
        f"/api/v1/projects/{pid}/characters/c1/growth/workshop/adjust",
        json={"stages": [
            {"stage_number": 1, "stage_name": "起点", "bound_chapter": 3,
             "trigger_event_type": "betrayal_experienced"}
        ]},
    )
    assert r.status_code == 200
    body = r.json()
    assert body["error"] is False
    saved = json.loads((proj / "characters.json").read_text())
    assert saved["characters"][0]["growth_curve"]["stages"][0]["bound_chapter"] == 3