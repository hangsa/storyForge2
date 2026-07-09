"""AC-9: 成长工坊一致性检查 — 低谷章节调整后能识别高强度冲突缺失。"""
import json
from pathlib import Path

from fastapi.testclient import TestClient

from backend.config import settings
from backend.main import app

client = TestClient(app)


def _setup_project(pid: str, low_chapter: int = 15):
    proj = Path(settings.projects_dir) / pid
    (proj / "storyos").mkdir(parents=True, exist_ok=True)
    (proj / "outline.json").write_text(json.dumps({
        "chapters": [{"chapter_number": i, "title": f"Ch{i}"}
                     for i in range(1, 21)]
    }))
    (proj / "characters.json").write_text(json.dumps({"characters": [
        {"id": "c1", "name": "林峰", "growth_curve": {"stages": [
            {"stage_number": 1, "stage_name": "低谷", "bound_chapter": low_chapter,
             "trigger_event_type": "irreversible_loss",
             "trigger_event_description": "", "character_change": "",
             "target_chapter_range": ""}
        ]}}
    ]}))
    (proj / "storyos" / "conflicts.json").write_text(json.dumps({"conflicts": []}))


def test_low_misaligned_warning_surfaces_in_ac9_flow():
    pid = "ac9_low_misaligned"
    _setup_project(pid, low_chapter=15)
    r = client.post(f"/api/v1/projects/{pid}/characters/c1/growth/workshop/check")
    assert r.status_code == 200
    body = r.json()
    rule_ids = [w["rule_id"] for w in body["detail"]["warnings"]]
    assert "low_misaligned" in rule_ids
    matched = next(w for w in body["detail"]["warnings"] if w["rule_id"] == "low_misaligned")
    assert matched["chapter_number"] == 15
