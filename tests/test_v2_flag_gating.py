"""Verify ENABLE_CANVAS_V2 controls whether the v2 router is mounted.

backend/main.py:100-102 only includes `v2_canvas_router` when
`settings.enable_canvas_v2` is True. This test mirrors that decision with a
minimal FastAPI app so we don't have to instantiate the full app (which
would require autopilot/executor/broadcaster wiring).

When the flag is False, GET /creative/canvas/{pid}/session/state returns 404
(router not mounted → no route matches). When the flag is True, the route
exists and returns whatever /state returns for a non-existent project
(missing canvas → 404 with a JSON error body, NOT a router-level 404).
"""
from fastapi import FastAPI
from fastapi.testclient import TestClient

from backend.api.v2_canvas import router as v2_router
from backend.config import settings


def _make_client(monkeypatch, enabled: bool) -> TestClient:
    """Build a minimal app that mirrors backend/main.py:100-102."""
    monkeypatch.setattr(settings, "enable_canvas_v2", enabled)
    app = FastAPI()
    if settings.enable_canvas_v2:
        app.include_router(v2_router)
    return TestClient(app)


def test_v2_state_returns_404_when_flag_disabled(tmp_path, monkeypatch):
    """With ENABLE_CANVAS_V2=false, the router is not mounted → 404 (no route)."""
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    client = _make_client(monkeypatch, enabled=False)

    response = client.get("/creative/canvas/p_flag_off/session/state")

    # Router not mounted at all → FastAPI's default 404 (no JSON body).
    assert response.status_code == 404
    assert response.json() == {"detail": "Not Found"}


def test_v2_state_returns_404_when_flag_enabled_but_no_canvas(
    tmp_path, monkeypatch
):
    """With ENABLE_CANVAS_V2=true, the router is mounted but no canvas on disk
    → /state returns 404 with a JSON error body (handler-level 404, not router-
    level). Proves the flag actually controls router mounting, not just any 404."""
    monkeypatch.setattr(settings, "projects_dir", tmp_path)
    client = _make_client(monkeypatch, enabled=True)

    response = client.get("/creative/canvas/p_flag_on_no_canvas/session/state")

    # Same status code as the disabled case, but the response shape differs:
    # mounted router's handler returns its own 404 (FastAPI wraps detail in
    # {"detail": ...}). Router-level 404 has {"detail": "Not Found"} (string).
    assert response.status_code == 404
    body = response.json()
    assert isinstance(body["detail"], dict), (
        f"Expected handler-level 404 with dict detail — got {body!r}. "
        "The v2 router was NOT actually mounted."
    )
    assert body["detail"]["code"] == "CANVAS_NOT_FOUND"