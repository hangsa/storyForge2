"""Shared convenience wrappers around the prompt override stores.

v1.9 prompt override wiring — every BaseAgent construction site uses these
helpers instead of inlining the singleton accessor calls. Keeps the call
sites uniform and makes it easy to add cross-cutting behavior later
(e.g. request-scoped stores for tests) in one place.
"""

from __future__ import annotations

from backend.services.prompt_override_store import (
    get_project_override_store,
)
from backend.services.global_prompt_override_store import (
    get_global_override_store,
)


def project_override_store():
    """Return the singleton per-project override store.

    Alias for `backend.services.prompt_override_store.get_project_override_store()`
    — exists so call sites read naturally at the Agent construction line.
    """
    return get_project_override_store()


def global_override_store():
    """Return the singleton global override store."""
    return get_global_override_store()
