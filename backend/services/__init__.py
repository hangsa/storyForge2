"""Backend services — reusable business logic decoupled from HTTP layer."""

# Re-export so tests can do `from backend.services import _file_manager` to
# patch the shared FileManager singleton (see
# tests/test_creative_divergence_api.py and the
# project_api_file_manager_pattern memory).
from backend.api.creative_divergence import _file_manager

__all__ = ["_file_manager"]
