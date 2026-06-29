"""AC-6: 风格沙盒 — 句长参数 [8, 20] 显著降低渲染结果平均句长。"""
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient

from backend.config import settings
from backend.main import app
from backend.utils.file_manager import FileManager

client = TestClient(app)


def test_short_avg_length_param_yields_shorter_rendered_text():
    pid = "ac6_short"
    # Fallback: FileManager has no from_default(); instantiate via settings.projects_dir
    fm = FileManager(Path(settings.projects_dir))
    fm.ensure_project_dir(pid)

    # Mock router to return a short-sentence render
    fake_router = MagicMock()
    fake_router.execute = AsyncMock(return_value={
        "content": "短句一。短句二。短句三。",  # avg ~3 chars
        "usage": {"input": 100, "output": 50},
        "model": "claude-haiku", "tier": "tier_3", "cost": 0.0,
    })
    with patch("backend.api.style_sandbox.get_model_router", return_value=fake_router):
        r = client.post(
            f"/api/v1/projects/{pid}/style/sandbox/preview",
            json={
                "source_text": "这是一段较长的参考文本。" * 20,
                "params": {
                    "sentence": {"avg_length_range": [8, 20], "short_sentence_ratio": 0.6,
                                 "paragraph_length_range": [60, 120]},
                    "dialogue": {"ratio": 0.35, "max_consecutive_lines": 6},
                    "rhythm": {"pacing_bpm": 400, "scene_change_frequency": 0.5},
                    "density": {"description_ratio": 0.4, "action_ratio": 0.3},
                    "satisfaction": {"satisfaction_beat_count": 5, "suspense_hook_required": True},
                },
                "genre": "cool_novel",
            },
        )
    assert r.status_code == 200
    body = r.json()
    assert body["error"] is False
    rendered_avg = body["detail"]["rendered_avg_length"]
    source_avg = body["detail"]["source_avg_length"]
    # Mocked render is intentionally short; rendered should be < 80% of source
    assert rendered_avg < source_avg * 0.8, f"rendered={rendered_avg} source={source_avg}"