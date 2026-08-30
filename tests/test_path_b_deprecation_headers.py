import pytest
from fastapi.testclient import TestClient
from fastapi import FastAPI
from backend.api.creative_divergence import router as cd_router, DeprecationHeadersMiddleware


@pytest.fixture
def client():
    app = FastAPI()
    app.add_middleware(DeprecationHeadersMiddleware)
    app.include_router(cd_router)
    return TestClient(app)


ENDPOINTS = [
    ("GET", "/api/projects/proj_dep/creative-divergence"),
    ("POST", "/api/projects/proj_dep/creative-divergence/generate"),
    ("POST", "/api/projects/proj_dep/creative-divergence/select"),
    ("GET", "/api/projects/proj_dep/creative-divergence/prefill-check"),
]


@pytest.mark.parametrize("method,path", ENDPOINTS)
def test_deprecation_headers_present(client, method, path):
    if method == "GET":
        r = client.get(path)
    else:
        r = client.post(path, json={})
    assert r.headers.get("Deprecation") == "true"
    assert r.headers.get("Sunset") == "2026-12-31"
    link = r.headers.get("Link", "")
    assert 'rel="successor-version"' in link
    assert "/api/v1/projects/proj_dep/creative/diverge/state" in link


def test_non_path_b_endpoint_unaffected(client):
    """Sanity check: a non-/creative-divergence route should NOT get the headers."""
    # The router only has 4 paths; this just verifies we don't accidentally
    # add headers to other endpoints when the middleware is mounted on a real app.
    r = client.get("/api/projects/proj_dep/some-other-route")
    # Either 404 (route doesn't exist) or 200, but Deprecation must be absent
    assert r.headers.get("Deprecation") is None
